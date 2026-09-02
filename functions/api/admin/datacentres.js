import { ensureSchema } from "../_schema.js";

function checkAuth(context) {
  const cookieHeader = context.request.headers.get("Cookie") || "";
  return cookieHeader.includes("of_admin_session=authenticated_of_admin");
}

function unauthorizedResponse() {
  return new Response(JSON.stringify({ success: false, message: "Unauthorized staff access." }), {
    status: 401,
    headers: { "Content-Type": "application/json" }
  });
}

export async function onRequestGet(context) {
  if (!checkAuth(context)) return unauthorizedResponse();

  const db = context.env.DB;
  try {
    await ensureSchema(db);

    const url = new URL(context.request.url);
    const id = url.searchParams.get("id");
    const search = url.searchParams.get("q") || "";

    if (id) {
      const item = await db.prepare("SELECT * FROM datacentres WHERE id = ?").bind(id).first();
      if (!item) {
        return new Response(JSON.stringify({ success: false, message: "Datacentre not found." }), {
          status: 404,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ success: true, datacentre: item }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    let query = "SELECT * FROM datacentres WHERE 1=1";
    const params = [];

    if (search) {
      query += " AND (name LIKE ? OR city LIKE ? OR developer LIKE ? OR address LIKE ?)";
      const wild = `%${search}%`;
      params.push(wild, wild, wild, wild);
    }

    query += " ORDER BY updated_at DESC, name ASC";

    const stmt = db.prepare(query);
    const { results } = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();

    return new Response(JSON.stringify({
      success: true,
      count: (results || []).length,
      datacentres: results || []
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("Error in admin GET datacentres:", error);
    return new Response(JSON.stringify({ success: false, message: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

export async function onRequestPost(context) {
  if (!checkAuth(context)) return unauthorizedResponse();

  const db = context.env.DB;
  try {
    await ensureSchema(db);

    const body = await context.request.json();
    const name = String(body.name || "").trim();
    const city = String(body.city || "").trim();
    const provinceState = String(body.province_state || body.province || "").trim().toUpperCase();
    const lat = parseFloat(body.lat);
    const lng = parseFloat(body.lng);

    if (!name || !city || isNaN(lat) || isNaN(lng)) {
      return new Response(JSON.stringify({
        success: false,
        message: "Missing required fields: name, city, latitude, and longitude are required."
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const id = body.id
      ? String(body.id).trim()
      : `of-dc-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();
    const capacityMw = body.capacity_mw != null && body.capacity_mw !== "" ? parseFloat(body.capacity_mw) : null;
    const capacityDisplay = body.capacity_display || (capacityMw != null ? String(capacityMw) : "Unknown");
    const noiseRadius = body.noise_radius_m != null && body.noise_radius_m !== "" ? parseFloat(body.noise_radius_m) : 1500;

    await db.prepare(`
      INSERT INTO datacentres (
        id, name, address, city, province_state, country,
        lat, lng, capacity_mw, capacity_display, proposal_status,
        site_type, developer, noise_radius_m, source_url,
        announced_date, notes, ai_tag, is_visible,
        created_at, updated_at, extra_json
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?
      )
    `).bind(
      id,
      name,
      body.address || "",
      city,
      provinceState || "BC",
      body.country || "Canada",
      lat,
      lng,
      capacityMw,
      capacityDisplay,
      body.proposal_status || "proposed",
      body.site_type || "datacentre",
      body.developer || "",
      noiseRadius,
      body.source_url || "",
      body.announced_date || "",
      body.notes || "",
      body.ai_tag ? 1 : 0,
      body.is_visible !== false && body.is_visible !== 0 ? 1 : 0,
      now,
      now,
      typeof body.extra === "object" ? JSON.stringify(body.extra) : (body.extra_json || "{}")
    ).run();

    const created = await db.prepare("SELECT * FROM datacentres WHERE id = ?").bind(id).first();

    return new Response(JSON.stringify({
      success: true,
      message: "Datacentre created successfully.",
      datacentre: created
    }), {
      status: 201,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("Error in admin POST datacentres:", error);
    return new Response(JSON.stringify({ success: false, message: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

export async function onRequestPut(context) {
  if (!checkAuth(context)) return unauthorizedResponse();

  const db = context.env.DB;
  try {
    await ensureSchema(db);

    const body = await context.request.json();
    const id = String(body.id || "").trim();

    if (!id) {
      return new Response(JSON.stringify({ success: false, message: "Datacentre ID is required for update." }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const existing = await db.prepare("SELECT id FROM datacentres WHERE id = ?").bind(id).first();
    if (!existing) {
      return new Response(JSON.stringify({ success: false, message: "Datacentre not found." }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      });
    }

    const now = new Date().toISOString();
    const capacityMw = body.capacity_mw != null && body.capacity_mw !== "" ? parseFloat(body.capacity_mw) : null;
    const capacityDisplay = body.capacity_display || (capacityMw != null ? String(capacityMw) : "Unknown");
    const noiseRadius = body.noise_radius_m != null && body.noise_radius_m !== "" ? parseFloat(body.noise_radius_m) : 1500;

    await db.prepare(`
      UPDATE datacentres SET
        name = ?,
        address = ?,
        city = ?,
        province_state = ?,
        country = ?,
        lat = ?,
        lng = ?,
        capacity_mw = ?,
        capacity_display = ?,
        proposal_status = ?,
        site_type = ?,
        developer = ?,
        noise_radius_m = ?,
        source_url = ?,
        announced_date = ?,
        notes = ?,
        ai_tag = ?,
        is_visible = ?,
        updated_at = ?,
        extra_json = ?
      WHERE id = ?
    `).bind(
      body.name,
      body.address || "",
      body.city,
      (body.province_state || body.province || "").toUpperCase(),
      body.country || "Canada",
      parseFloat(body.lat),
      parseFloat(body.lng),
      capacityMw,
      capacityDisplay,
      body.proposal_status || "proposed",
      body.site_type || "datacentre",
      body.developer || "",
      noiseRadius,
      body.source_url || "",
      body.announced_date || "",
      body.notes || "",
      body.ai_tag ? 1 : 0,
      body.is_visible !== false && body.is_visible !== 0 ? 1 : 0,
      now,
      typeof body.extra === "object" ? JSON.stringify(body.extra) : (body.extra_json || "{}"),
      id
    ).run();

    const updated = await db.prepare("SELECT * FROM datacentres WHERE id = ?").bind(id).first();

    return new Response(JSON.stringify({
      success: true,
      message: "Datacentre updated successfully.",
      datacentre: updated
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("Error in admin PUT datacentres:", error);
    return new Response(JSON.stringify({ success: false, message: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

export async function onRequestPatch(context) {
  if (!checkAuth(context)) return unauthorizedResponse();

  const db = context.env.DB;
  try {
    await ensureSchema(db);

    const body = await context.request.json();
    const id = String(body.id || "").trim();

    if (!id) {
      return new Response(JSON.stringify({ success: false, message: "Datacentre ID required." }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (body.is_visible !== undefined) {
      const isVisible = body.is_visible ? 1 : 0;
      await db.prepare(`
        UPDATE datacentres
        SET is_visible = ?, updated_at = ?
        WHERE id = ?
      `).bind(isVisible, new Date().toISOString(), id).run();

      return new Response(JSON.stringify({
        success: true,
        message: `Visibility set to ${isVisible ? "public" : "hidden"}.`,
        is_visible: isVisible
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ success: false, message: "No supported patch field provided." }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("Error in admin PATCH datacentres:", error);
    return new Response(JSON.stringify({ success: false, message: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

export async function onRequestDelete(context) {
  if (!checkAuth(context)) return unauthorizedResponse();

  const db = context.env.DB;
  try {
    await ensureSchema(db);

    const url = new URL(context.request.url);
    let id = url.searchParams.get("id");

    if (!id && context.request.headers.get("Content-Type")?.includes("application/json")) {
      const body = await context.request.json();
      id = body.id;
    }

    if (!id) {
      return new Response(JSON.stringify({ success: false, message: "Datacentre ID required for deletion." }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    await db.prepare("DELETE FROM datacentres WHERE id = ?").bind(id).run();

    return new Response(JSON.stringify({
      success: true,
      message: `Datacentre ${id} deleted successfully.`
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error("Error in admin DELETE datacentres:", error);
    return new Response(JSON.stringify({ success: false, message: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
