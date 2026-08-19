import { ensureSchema } from "../_schema.js";

export async function onRequestGet(context) {
  const db = context.env.DB;
  
  // 1. Check Authentication
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
    
    const url = new URL(context.request.url);
    const siteId = url.searchParams.get("id");
    const isCsvExport = url.searchParams.get("export") === "csv";
    
    // --- SINGLE SITE DETAIL REQUEST ---
    if (siteId) {
      const site = await db.prepare(`
        SELECT 
          s.*,
          p.existing_capacity_mw, p.firm_power_available_mw, p.additional_power_mw, p.max_potential_capacity_mw, p.power_type, p.utility_provider, p.grid_status, p.substation_on_near_site, p.transmission_infra, p.voltage_kv, p.time_to_capacity, p.delivered_cost_mwh, p.generation_source, p.renewable_pct, p.has_ppa, p.ppa_remaining_term, p.demand_restrictions, p.other_constraints,
          c.fibre_available, c.fibre_providers, c.diverse_routes, c.distance_to_fibre, c.telecom_infra, c.latency_limitations,
          d.zoning, d.data_centre_permitted, d.permitting_complexity, d.environmental_approvals, d.environmental_restrictions, d.flood_exposure, d.wildfire_exposure, d.seismic_exposure, d.other_natural_hazards, d.site_access_roads, d.proximity_airport_port, d.construction_logistics_constraints,
          w.water_availability, w.municipal_water, w.industrial_water, w.air_cooled_compatible, w.sewer_access, w.gas_availability, w.distance_to_gas_pipeline, w.existing_industrial_services,
          cs.community_attitude, cs.history_protests, cs.known_litigation, cs.municipal_support, cs.economic_dev_support, cs.indigenous_engagement_req, cs.indigenous_relationships, cs.other_stakeholder_concerns,
          con.name as contact_name, con.company as contact_company, con.email as contact_email, con.phone as contact_phone, con.relationship_to_property as contact_relationship, con.preferred_contact_method, con.comments as contact_comments,
          r.classification, r.calculated_score, r.confidence_level, r.key_strengths, r.verification_issues, r.potential_constraints, r.recommended_steps
        FROM sites s
        LEFT JOIN power_info p ON s.id = p.site_id
        LEFT JOIN connectivity_info c ON s.id = c.site_id
        LEFT JOIN development_info d ON s.id = d.site_id
        LEFT JOIN water_infrastructure_info w ON s.id = w.site_id
        LEFT JOIN community_stakeholder_info cs ON s.id = cs.site_id
        LEFT JOIN contacts con ON s.id = con.site_id
        LEFT JOIN assessment_results r ON s.id = r.site_id
        WHERE s.id = ?
      `).bind(parseInt(siteId)).first();
      
      if (!site) {
        return new Response(JSON.stringify({ success: false, message: "Site not found." }), {
          status: 404,
          headers: { "Content-Type": "application/json" }
        });
      }
      
      // Parse JSON lists
      if (site.project_types) site.project_types = JSON.parse(site.project_types);
      if (site.key_strengths) site.key_strengths = JSON.parse(site.key_strengths);
      if (site.verification_issues) site.verification_issues = JSON.parse(site.verification_issues);
      if (site.potential_constraints) site.potential_constraints = JSON.parse(site.potential_constraints);
      if (site.recommended_steps) site.recommended_steps = JSON.parse(site.recommended_steps);
      
      return new Response(JSON.stringify({ success: true, site: site }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // --- LIST OR EXPORT REQUEST ---
    const search = url.searchParams.get("q") || "";
    const country = url.searchParams.get("country") || "";
    const provState = url.searchParams.get("province_state") || "";
    const classification = url.searchParams.get("classification") || "";
    const opportunityType = url.searchParams.get("opportunity_type") || "";
    const minPotentialMw = url.searchParams.get("min_potential_mw") || "";
    const minFirmMw = url.searchParams.get("min_firm_mw") || "";
    const sortBy = url.searchParams.get("sort_by") || "created_at";
    const sortOrder = url.searchParams.get("sort_order") || "desc";
    
    // Build dynamic query
    let query = `
      SELECT 
        s.id, s.name, s.city, s.province_state, s.country, s.created_at, s.lead_status, s.is_confidential, s.opportunity_type, s.target_size_mw,
        p.firm_power_available_mw, p.max_potential_capacity_mw,
        con.name as contact_name, con.company as contact_company, con.email as contact_email,
        r.classification, r.calculated_score, r.confidence_level
      FROM sites s
      LEFT JOIN power_info p ON s.id = p.site_id
      LEFT JOIN contacts con ON s.id = con.site_id
      LEFT JOIN assessment_results r ON s.id = r.site_id
      WHERE 1=1
    `;
    
    const params = [];
    
    if (search) {
      query += ` AND (s.name LIKE ? OR s.city LIKE ? OR s.address LIKE ? OR con.name LIKE ? OR con.email LIKE ?)`;
      const searchWild = `%${search}%`;
      params.push(searchWild, searchWild, searchWild, searchWild, searchWild);
    }
    
    if (country) {
      query += ` AND s.country = ?`;
      params.push(country);
    }
    
    if (provState) {
      query += ` AND s.province_state = ?`;
      params.push(provState);
    }
    
    if (classification) {
      query += ` AND r.classification = ?`;
      params.push(classification);
    }
    
    if (opportunityType) {
      query += ` AND s.opportunity_type = ?`;
      params.push(opportunityType);
    }
    
    if (minPotentialMw) {
      query += ` AND p.max_potential_capacity_mw >= ?`;
      params.push(parseFloat(minPotentialMw));
    }
    
    if (minFirmMw) {
      query += ` AND p.firm_power_available_mw >= ?`;
      params.push(parseFloat(minFirmMw));
    }
    
    // Sort validation
    const allowedSort = ["created_at", "firm_power_available_mw", "max_potential_capacity_mw", "name", "calculated_score"];
    const verifiedSort = allowedSort.includes(sortBy) ? sortBy : "created_at";
    const verifiedOrder = ["asc", "desc"].includes(sortOrder.toLowerCase()) ? sortOrder : "desc";
    
    query += ` ORDER BY ${verifiedSort} ${verifiedOrder}`;
    
    // Execute query
    const statement = db.prepare(query);
    const { results } = params.length > 0 ? await statement.bind(...params).all() : await statement.all();
    
    // --- EXPORT CSV MODE ---
    if (isCsvExport) {
      const csvRows = [
        ["ID", "Property Name", "City", "Province/State", "Country", "Classification", "Score", "Confidence", "Firm MW", "Potential MW", "Opportunity Type", "Target MW", "Contact Name", "Contact Company", "Contact Email", "Created Date", "Lead Status", "Confidential"]
      ];
      
      for (const row of results) {
        csvRows.push([
          row.id,
          row.name,
          row.city,
          row.province_state,
          row.country,
          row.classification,
          row.calculated_score,
          row.confidence_level,
          row.firm_power_available_mw !== null ? row.firm_power_available_mw : "Unknown",
          row.max_potential_capacity_mw !== null ? row.max_potential_capacity_mw : "Unknown",
          row.opportunity_type,
          row.target_size_mw !== null ? row.target_size_mw : "",
          row.contact_name,
          row.contact_company,
          row.contact_email,
          row.created_at,
          row.lead_status,
          row.is_confidential === 1 ? "Yes" : "No"
        ]);
      }
      
      const csvContent = csvRows.map(e => e.map(val => {
        // Escape quotes and wrap in quotes if contains comma, newline or quotes
        let text = String(val);
        if (text.includes(",") || text.includes("\n") || text.includes('"')) {
          text = '"' + text.replace(/"/g, '""') + '"';
        }
        return text;
      }).join(",")).join("\n");
      
      return new Response(csvContent, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": "attachment; filename=ocean_falls_sites.csv"
        }
      });
    }
    
    // --- LIST MODE ---
    return new Response(JSON.stringify({ success: true, sites: results }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error("Error retrieving admin site list:", error);
    return new Response(JSON.stringify({ success: false, message: "Error fetching data.", error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  
  // 1. Check Authentication
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
    
    const body = await context.request.json();
    const siteId = parseInt(body.id);
    
    if (!siteId) {
      return new Response(JSON.stringify({ success: false, message: "Missing valid site id." }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // Support updating internal notes, status, and confidentiality
    await db.prepare(`
      UPDATE sites
      SET internal_notes = ?, lead_status = ?, is_confidential = ?
      WHERE id = ?
    `).bind(
      body.internal_notes || "",
      body.lead_status || "New",
      body.is_confidential ? 1 : 0,
      siteId
    ).run();
    
    return new Response(JSON.stringify({ success: true, message: "Site details updated." }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error("Error updating site details:", error);
    return new Response(JSON.stringify({ success: false, message: "Error updating site details.", error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
