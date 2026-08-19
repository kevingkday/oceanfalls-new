export async function onRequestPost(context) {
  const db = context.env.DB;
  
  try {
    const body = await context.request.json();
    const siteId = parseInt(body.site_id);
    
    if (!siteId) {
      return new Response(JSON.stringify({
        success: false,
        message: "Missing valid site_id parameter."
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    
    // 1. Update the contacts table for the site
    await db.prepare(`
      UPDATE contacts 
      SET name = ?, company = ?, email = ?, phone = ?, 
          relationship_to_property = ?, preferred_contact_method = ?, comments = ?
      WHERE site_id = ?
    `).bind(
      body.name || "",
      body.company || "",
      body.email || "",
      body.phone || "",
      body.relationship_to_property || "",
      body.preferred_contact_method || "",
      body.comments || "",
      siteId
    ).run();
    
    // 2. Set lead status to 'New'
    await db.prepare(`
      UPDATE sites
      SET lead_status = 'New'
      WHERE id = ?
    `).bind(siteId).run();
    
    // 3. Fetch detailed site data & assessment results to forward to GoHighLevel
    let siteDetails = null;
    try {
      siteDetails = await db.prepare(`
        SELECT 
          s.name as site_name, s.city, s.province_state, s.country, s.acreage, s.current_use, s.ownership_status, s.opportunity_type, s.target_size_mw,
          p.firm_power_available_mw, p.max_potential_capacity_mw, p.power_type, p.delivered_cost_mwh,
          c.diverse_routes, c.fibre_available,
          d.zoning, d.data_centre_permitted,
          r.classification, r.calculated_score
        FROM sites s
        LEFT JOIN power_info p ON s.id = p.site_id
        LEFT JOIN connectivity_info c ON s.id = c.site_id
        LEFT JOIN development_info d ON s.id = d.site_id
        LEFT JOIN assessment_results r ON s.id = r.site_id
        WHERE s.id = ?
      `).bind(siteId).first();
    } catch (dbErr) {
      console.error("Error fetching site details for webhook:", dbErr);
    }

    // 4. Trigger GoHighLevel Webhook (if URL configured)
    const ghlUrl = context.env.GOHIGHLEVEL_WEBHOOK_URL;
    if (ghlUrl && siteDetails) {
      try {
        const firstName = body.name ? body.name.split(" ")[0] : "";
        const lastName = body.name ? body.name.split(" ").slice(1).join(" ") : "";
        
        const ghlPayload = {
          first_name: firstName,
          last_name: lastName,
          name: body.name || "",
          email: body.email || "",
          phone: body.phone || "",
          companyName: body.company || "",
          tags: ["Data Centre Assessment", siteDetails.classification || ""],
          source: "Ocean Falls Site Assessment",
          customFields: {
            site_id: siteId,
            property_name: siteDetails.site_name || "",
            location: `${siteDetails.city || ""}, ${siteDetails.province_state || ""}, ${siteDetails.country || ""}`,
            acreage: siteDetails.acreage || "",
            classification: siteDetails.classification || "",
            score: siteDetails.calculated_score || "",
            firm_mw: siteDetails.firm_power_available_mw !== null ? siteDetails.firm_power_available_mw : "Unknown",
            potential_mw: siteDetails.max_potential_capacity_mw !== null ? siteDetails.max_potential_capacity_mw : "Unknown",
            power_type: siteDetails.power_type || "",
            power_cost: siteDetails.delivered_cost_mwh !== null ? `$${siteDetails.delivered_cost_mwh}/MWh` : "Unknown",
            diverse_routes: siteDetails.diverse_routes || "",
            zoning: siteDetails.zoning || "",
            dc_permitted: siteDetails.data_centre_permitted || "",
            admin_link: `https://oceanfalls-new.kevin-c8e.workers.dev/admin?id=${siteId}`,
            comments: body.comments || ""
          }
        };

        const postPromise = fetch(ghlUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ghlPayload)
        }).then(res => {
          if (!res.ok) {
            console.error("GoHighLevel Webhook returned error status:", res.status);
          } else {
            console.log("Successfully posted lead contact details to GoHighLevel.");
          }
        }).catch(err => {
          console.error("Failed to send webhook to GoHighLevel:", err);
        });

        // Use waitUntil if available so the client request isn't blocked
        if (context.waitUntil) {
          context.waitUntil(postPromise);
        } else {
          // Fallback if waitUntil is not injected (e.g. simple test calls)
          await postPromise;
        }
      } catch (ghlErr) {
        console.error("Error setting up GoHighLevel webhook payload:", ghlErr);
      }
    }
    
    return new Response(JSON.stringify({
      success: true,
      message: "Lead information successfully recorded."
    }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error("Error saving lead details:", error);
    return new Response(JSON.stringify({
      success: false,
      message: "Failed to record contact information.",
      error: error.message
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
