import { ensureSchema } from "../_schema.js";

// Helper to determine province from location intel or known coords/cities
function inferProvince(proposal) {
  const meta = proposal.meta || {};
  const extra = meta.extra || {};
  if (extra.location_intel && extra.location_intel.province) {
    return extra.location_intel.province;
  }
  if (extra.alberta_datacentre_watch) {
    return "AB";
  }
  if (extra.ieso) {
    return "ON";
  }

  const city = (proposal.city || "").toLowerCase();
  if (city.includes("ontario") || ["cambridge", "hamilton", "burlington", "etobicoke", "fergus", "fort erie", "milton", "borden", "greater napanee", "essex county", "algoma region", "kingston", "london", "ottawa", "toronto", "windsor", "vaughan", "brampton", "mississauga", "markham"].some(c => city.includes(c))) {
    return "ON";
  }
  if (city.includes("alberta") || ["calgary", "edmonton", "bonnyville", "brazeau county", "chestermere", "duffield", "foothills county", "grande cache", "lacombe county", "leduc county"].some(c => city.includes(c))) {
    return "AB";
  }
  if (city.includes("bc") || city.includes("british columbia") || ["kamloops", "christina lake", "vancouver", "prince george", "ocean falls"].some(c => city.includes(c))) {
    return "BC";
  }
  if (city.includes("quebec") || ["montreal", "laval", "quebec city"].some(c => city.includes(c))) {
    return "QC";
  }

  // Fallback by longitude roughly
  const lng = Number(proposal.lng);
  if (lng < -114) return "BC";
  if (lng < -110) return "AB";
  if (lng < -101) return "SK";
  if (lng < -95) return "MB";
  if (lng < -74) return "ON";
  return "QC";
}

function resolveProjectName(proposal) {
  const meta = proposal.meta || {};
  const extra = meta.extra || {};
  if (extra.project_title) return extra.project_title;
  if (extra.ieso && extra.ieso.project_name) return extra.ieso.project_name;
  if (meta.notes) {
    const head = meta.notes.split(" — ")[0].split(". ")[0].trim();
    if (head && head.length < 80) return head;
  }
  if (meta.developer) return `${meta.developer} (${proposal.city || "Facility"})`;
  return proposal.address || `${proposal.city || "Canadian"} Datacentre Proposal`;
}

export async function onRequestPost(context) {
  const db = context.env.DB;

  // 1. Authentication check
  const cookieHeader = context.request.headers.get("Cookie") || "";
  const isAuthenticated = cookieHeader.includes("of_admin_session=authenticated_of_admin");
  if (!isAuthenticated) {
    return new Response(JSON.stringify({ success: false, message: "Unauthorized." }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    await ensureSchema(db);

    // 2. Fetch live data from source
    let proposals = [];
    try {
      const resp = await fetch("https://stopthedatacentre.ca/api/map/proposals", {
        headers: { "User-Agent": "OceanFalls-DataSync/1.0" }
      });
      if (resp.ok) {
        const json = await resp.json();
        if (Array.isArray(json.proposals)) {
          proposals = json.proposals;
        }
      }
    } catch (err) {
      console.error("Failed to fetch remote proposals feed:", err);
      return new Response(JSON.stringify({ success: false, message: "Could not fetch source data: " + err.message }), {
        status: 502,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (!proposals.length) {
      return new Response(JSON.stringify({ success: false, message: "No proposals found in source feed." }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    // 3. Upsert statements into D1
    const stmts = [];
    const now = new Date().toISOString();

    for (const p of proposals) {
      if (!p.id || p.lat == null || p.lng == null) continue;

      const name = resolveProjectName(p);
      const province = inferProvince(p);
      const meta = p.meta || {};
      const extra = meta.extra || {};
      const aiTag = extra.ai_tag || meta.site_type === "ai_datacentre" ? 1 : 0;
      const isVisible = p.show_map !== false ? 1 : 0;

      stmts.push(db.prepare(`
        INSERT INTO datacentres (
          id, name, address, city, province_state, country,
          lat, lng, capacity_mw, capacity_display, proposal_status,
          site_type, developer, noise_radius_m, source_url,
          announced_date, notes, ai_tag, is_visible,
          created_at, updated_at, extra_json
        ) VALUES (
          ?, ?, ?, ?, ?, 'Canada',
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?
        )
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          address = excluded.address,
          city = excluded.city,
          province_state = excluded.province_state,
          lat = excluded.lat,
          lng = excluded.lng,
          capacity_mw = excluded.capacity_mw,
          capacity_display = excluded.capacity_display,
          proposal_status = excluded.proposal_status,
          site_type = excluded.site_type,
          developer = excluded.developer,
          noise_radius_m = excluded.noise_radius_m,
          source_url = excluded.source_url,
          announced_date = excluded.announced_date,
          notes = excluded.notes,
          ai_tag = excluded.ai_tag,
          updated_at = excluded.updated_at,
          extra_json = excluded.extra_json
      `).bind(
        String(p.id),
        name,
        p.address || "",
        p.city || "Unknown",
        province,
        Number(p.lat),
        Number(p.lng),
        meta.capacity_mw != null ? Number(meta.capacity_mw) : null,
        meta.capacity_display || (meta.capacity_mw != null ? String(meta.capacity_mw) : "Unknown"),
        meta.proposal_status || "proposed",
        meta.site_type || "datacentre",
        meta.developer || "",
        p.noise_radius_m != null ? Number(p.noise_radius_m) : 1500,
        meta.source_url || p.url || "",
        meta.announced_date || "",
        meta.notes || "",
        aiTag,
        isVisible,
        now,
        now,
        JSON.stringify(extra)
      ));
    }

    // Run in batches of 40
    for (let i = 0; i < stmts.length; i += 40) {
      await db.batch(stmts.slice(i, i + 40));
    }
    const processed = stmts.length;

    return new Response(JSON.stringify({
      success: true,
      message: `Successfully processed ${processed} datacentres into database.`,
      count: processed
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("Error seeding datacentres:", error);
    return new Response(JSON.stringify({
      success: false,
      message: "Internal error during seeding.",
      error: error.message
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
