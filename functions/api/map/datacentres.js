import { ensureSchema } from "../_schema.js";

export async function onRequestGet(context) {
  const db = context.env.DB;

  try {
    await ensureSchema(db);

    const url = new URL(context.request.url);
    const search = url.searchParams.get("q") || "";
    const city = url.searchParams.get("city") || "";
    const province = url.searchParams.get("province") || "";
    const status = url.searchParams.get("status") || "";
    const siteType = url.searchParams.get("site_type") || "";
    const minMw = url.searchParams.get("min_mw") || "";
    const aiOnly = url.searchParams.get("ai_only") === "1" || url.searchParams.get("ai_only") === "true";
    const singleId = url.searchParams.get("id") || "";

    // Single item query
    if (singleId) {
      const item = await db.prepare(`
        SELECT * FROM datacentres WHERE id = ? AND is_visible = 1
      `).bind(singleId).first();

      if (!item) {
        return new Response(JSON.stringify({ success: false, message: "Datacentre not found." }), {
          status: 404,
          headers: { "Content-Type": "application/json" }
        });
      }

      if (item.extra_json) {
        try { item.extra = JSON.parse(item.extra_json); } catch (e) { item.extra = {}; }
      }

      return new Response(JSON.stringify({ success: true, datacentre: item }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // List query
    let query = `
      SELECT 
        id, name, address, city, province_state, country,
        lat, lng, capacity_mw, capacity_display, proposal_status,
        site_type, developer, noise_radius_m, source_url,
        announced_date, notes, ai_tag, is_visible,
        created_at, updated_at, extra_json
      FROM datacentres
      WHERE is_visible = 1
    `;

    const params = [];

    if (search) {
      query += ` AND (name LIKE ? OR city LIKE ? OR address LIKE ? OR developer LIKE ? OR notes LIKE ?)`;
      const searchWild = `%${search}%`;
      params.push(searchWild, searchWild, searchWild, searchWild, searchWild);
    }

    if (city) {
      query += ` AND LOWER(city) = LOWER(?)`;
      params.push(city);
    }

    if (province) {
      query += ` AND (province_state = ? OR LOWER(province_state) = LOWER(?))`;
      params.push(province, province);
    }

    if (status) {
      query += ` AND proposal_status = ?`;
      params.push(status);
    }

    if (siteType) {
      query += ` AND site_type = ?`;
      params.push(siteType);
    }

    if (minMw) {
      query += ` AND capacity_mw >= ?`;
      params.push(parseFloat(minMw));
    }

    if (aiOnly) {
      query += ` AND (ai_tag = 1 OR site_type = 'ai_datacentre')`;
    }

    query += ` ORDER BY CASE WHEN capacity_mw IS NULL THEN 1 ELSE 0 END, capacity_mw DESC, city ASC`;

    const statement = db.prepare(query);
    const { results } = params.length > 0 ? await statement.bind(...params).all() : await statement.all();

    const formatted = (results || []).map((item) => {
      let extra = {};
      if (item.extra_json) {
        try { extra = JSON.parse(item.extra_json); } catch (e) {}
      }
      return {
        ...item,
        extra
      };
    });

    return new Response(JSON.stringify({
      success: true,
      count: formatted.length,
      datacentres: formatted
    }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60, s-maxage=300"
      }
    });

  } catch (error) {
    console.error("Error fetching public datacentres:", error);
    return new Response(JSON.stringify({
      success: false,
      message: "Error fetching datacentres.",
      error: error.message
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
