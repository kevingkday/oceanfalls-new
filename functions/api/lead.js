import { ensureSchema } from "./_schema.js";

export async function onRequestPost(context) {
  const db = context.env.DB;
  
  try {
    await ensureSchema(db);

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

    // Combine scheduling preference with comments if provided
    const combinedComments = [
      body.preferred_window ? `Preferred Pilot Call Window: ${body.preferred_window}` : "",
      body.comments || ""
    ].filter(Boolean).join(" | ");
    
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
      combinedComments,
      siteId
    ).run();
    
    // 2. Set lead status to 'New'
    await db.prepare(`
      UPDATE sites
      SET lead_status = 'New'
      WHERE id = ?
    `).bind(siteId).run();
    
    // 3. Fetch detailed site data & assessment results to build the email report
    let siteDetails = null;
    try {
      siteDetails = await db.prepare(`
        SELECT 
          s.name as site_name, s.city, s.province_state, s.country, s.acreage, s.current_use, s.ownership_status, s.opportunity_type, s.target_size_mw, s.assessment_track,
          p.firm_power_available_mw, p.max_potential_capacity_mw, p.power_type, p.delivered_cost_mwh, p.grid_status,
          c.diverse_routes, c.fibre_available, c.telecom_infra,
          d.zoning, d.data_centre_permitted,
          w.air_cooled_compatible, w.existing_industrial_services,
          r.classification, r.calculated_score, r.confidence_level, r.key_strengths, r.verification_issues, r.potential_constraints, r.recommended_steps, r.raw_submission_json
        FROM sites s
        LEFT JOIN power_info p ON s.id = p.site_id
        LEFT JOIN connectivity_info c ON s.id = c.site_id
        LEFT JOIN development_info d ON s.id = d.site_id
        LEFT JOIN water_infrastructure_info w ON s.id = w.site_id
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

        const track = siteDetails.assessment_track === "micronode" ? "micronode" : "industrial";
        const isMicroNode = track === "micronode";
        const trackBadgeText = isMicroNode
          ? "TRACK A: MICRONODE / ON-PREMISE DEPLOYMENT"
          : "TRACK B: INDUSTRIAL POWER / BROWNFIELD SITING";
        const scoreHeaderLabel = isMicroNode
          ? "MicroNode Deployment Readiness Score"
          : "Speed-to-Power Readiness Score";
        const ctaTypeLabel = isMicroNode
          ? "15-Minute MicroNode Pilot Assessment Request"
          : "Industrial Site Infrastructure Review Request";

        let rawSub = {};
        try {
          rawSub = JSON.parse(siteDetails.raw_submission_json || "{}");
        } catch (e) {}

        // Parse results arrays
        const strengths = JSON.parse(siteDetails.key_strengths || "[]");
        const issues = JSON.parse(siteDetails.verification_issues || "[]");
        const constraints = JSON.parse(siteDetails.potential_constraints || "[]");
        const steps = JSON.parse(siteDetails.recommended_steps || "[]");

        // Format HTML lists for email body
        const strengthsHtml = strengths.map(s => `<li style="margin-bottom: 6px; list-style-type: none;">✔️ ${s}</li>`).join("");
        const issuesHtml = issues.map(i => `<li style="margin-bottom: 6px; list-style-type: none;">🔍 ${i}</li>`).join("");
        const constraintsHtml = constraints.map(c => `<li style="margin-bottom: 6px; list-style-type: none;">⚠️ ${c}</li>`).join("");
        const stepsHtml = steps.map(s => `<li style="margin-bottom: 6px; list-style-type: none;">➔ ${s}</li>`).join("");

        // Track-specific intake summary rows
        const intakeRowsHtml = isMicroNode ? `
          <tr>
            <td style="padding: 6px 0; font-weight: bold; width: 42%; color: #718096;">Organization Type:</td>
            <td style="padding: 6px 0; color: #2d3748;">${rawSub.mn_org_type || siteDetails.current_use || "-"}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; font-weight: bold; color: #718096;">Primary AI Use Case:</td>
            <td style="padding: 6px 0; color: #2d3748;">${(rawSub.mn_use_cases || []).join(", ") || rawSub.mn_primary_use_case || "-"}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; font-weight: bold; color: #718096;">Compliance / Residency:</td>
            <td style="padding: 6px 0; color: #2d3748;">${rawSub.mn_compliance || siteDetails.zoning || "-"}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; font-weight: bold; color: #718096;">Proposed Placement:</td>
            <td style="padding: 6px 0; color: #2d3748;">${rawSub.mn_placement || "-"}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; font-weight: bold; color: #718096;">Electrical Service:</td>
            <td style="padding: 6px 0; color: #2d3748;">${rawSub.mn_electrical || siteDetails.power_type || "-"}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; font-weight: bold; color: #718096;">Network Boundary:</td>
            <td style="padding: 6px 0; color: #2d3748;">${rawSub.mn_network || siteDetails.fibre_available || "-"}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; font-weight: bold; color: #718096;">Monthly Doc Volume:</td>
            <td style="padding: 6px 0; color: #2d3748;">${rawSub.mn_doc_volume || "-"}</td>
          </tr>
          ${body.preferred_window ? `
          <tr>
            <td style="padding: 6px 0; font-weight: bold; color: #465f88;">Preferred Call Window:</td>
            <td style="padding: 6px 0; font-weight: bold; color: #2d3748;">${body.preferred_window}</td>
          </tr>` : ""}
        ` : `
          <tr>
            <td style="padding: 6px 0; font-weight: bold; width: 42%; color: #718096;">Site Classification:</td>
            <td style="padding: 6px 0; color: #2d3748;">${rawSub.site_classification || siteDetails.current_use || "-"}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; font-weight: bold; color: #718096;">Available Capacity:</td>
            <td style="padding: 6px 0; color: #2d3748;">${rawSub.capacity_band || (siteDetails.firm_power_available_mw ? `${siteDetails.firm_power_available_mw} MW` : "-")}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; font-weight: bold; color: #718096;">Interconnection Status:</td>
            <td style="padding: 6px 0; color: #2d3748;">${rawSub.interconnection_status || siteDetails.grid_status || "-"}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; font-weight: bold; color: #718096;">Fiber Connectivity:</td>
            <td style="padding: 6px 0; color: #2d3748;">${rawSub.fiber_status || siteDetails.fibre_available || "-"}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; font-weight: bold; color: #718096;">Footprint / Pad Space:</td>
            <td style="padding: 6px 0; color: #2d3748;">${rawSub.pad_space || siteDetails.existing_industrial_services || "-"}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; font-weight: bold; color: #718096;">Dry Cooler Suitability:</td>
            <td style="padding: 6px 0; color: #2d3748;">${rawSub.cooling_suitability || siteDetails.air_cooled_compatible || "-"}</td>
          </tr>
        `;

        const statusColor = (siteDetails.classification || "").includes("Ready for Pilot") || (siteDetails.classification || "").includes("Fast-Track") || siteDetails.classification === "Promising"
          ? "#2f855a"
          : (siteDetails.classification || "").includes("Outside") || (siteDetails.classification || "").includes("Unlikely")
            ? "#c53030"
            : "#c05621";

        // Build premium, email-ready HTML body with clear track flagging
        const generatedBody = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #283439; line-height: 1.6; border: 1px solid #e2e8f0; border-radius: 0px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
  <div style="background-color: #283439; padding: 10px 24px; text-align: center; color: #d6e3ff; font-size: 11px; font-weight: bold; letter-spacing: 1.5px; text-transform: uppercase;">
    ${trackBadgeText}
  </div>
  <div style="background-color: #465f88; padding: 28px 24px; text-align: center; color: white;">
    <h1 style="margin: 0; font-size: 24px; font-weight: bold; letter-spacing: -0.5px;">Ocean Falls Technology</h1>
    <p style="margin: 6px 0 0 0; font-size: 12px; opacity: 0.9; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 600;">${scoreHeaderLabel}</p>
  </div>
  
  <div style="padding: 32px 24px; background-color: #ffffff;">
    <p style="font-size: 16px; margin-top: 0;">Dear ${body.name || "Partner"},</p>
    
    <p>${isMicroNode
      ? "Thank you for completing the Ocean Falls MicroNode Readiness Assessment. We have received your request to schedule a 15-minute MicroNode Pilot Assessment and our team is reviewing your deployment profile."
      : "Thank you for submitting your industrial property for a Speed-to-Power Assessment. We have received your inquiry and our infrastructure team is reviewing your site parameters."}</p>
    
    <div style="background-color: #f7fafc; border-left: 4px solid #465f88; padding: 20px; margin: 24px 0; border-radius: 0px;">
      <h3 style="margin-top: 0; margin-bottom: 12px; color: #465f88; font-size: 15px; text-transform: uppercase; letter-spacing: 0.5px;">${scoreHeaderLabel}</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr>
          <td style="padding: 6px 0; font-weight: bold; width: 42%; color: #718096;">Assessment Track:</td>
          <td style="padding: 6px 0; font-weight: 700; color: #465f88;">${isMicroNode ? "Track A — MicroNode On-Premise" : "Track B — Industrial Power / Brownfield"}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-weight: bold; color: #718096;">${isMicroNode ? "Organization / Facility:" : "Property / Site:"}</td>
          <td style="padding: 6px 0; font-weight: 600; color: #2d3748;">${siteDetails.site_name || "Unspecified"} (${siteDetails.city || "-"}, ${siteDetails.province_state || "BC"})</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-weight: bold; color: #718096;">Readiness Status:</td>
          <td style="padding: 6px 0; font-weight: bold; color: ${statusColor};">${siteDetails.classification}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-weight: bold; color: #718096;">Readiness Score:</td>
          <td style="padding: 6px 0; font-weight: bold; color: #2d3748; font-size: 16px;">${siteDetails.calculated_score} / 100 (${siteDetails.confidence_level} Confidence)</td>
        </tr>
        ${intakeRowsHtml}
      </table>
    </div>

    ${strengthsHtml ? `
    <h4 style="color: #465f88; margin-top: 24px; margin-bottom: 10px; border-bottom: 1px solid #edf2f7; padding-bottom: 6px; font-size: 15px;">✔️ Key Readiness Strengths</h4>
    <ul style="margin-top: 0; padding-left: 0; font-size: 14px; line-height: 1.5;">
      ${strengthsHtml}
    </ul>
    ` : ''}

    ${issuesHtml ? `
    <h4 style="color: #465f88; margin-top: 24px; margin-bottom: 10px; border-bottom: 1px solid #edf2f7; padding-bottom: 6px; font-size: 15px;">🔍 Items to Verify</h4>
    <ul style="margin-top: 0; padding-left: 0; font-size: 14px; line-height: 1.5;">
      ${issuesHtml}
    </ul>
    ` : ''}

    ${constraintsHtml ? `
    <h4 style="color: #c53030; margin-top: 24px; margin-bottom: 10px; border-bottom: 1px solid #fed7d7; padding-bottom: 6px; font-size: 15px;">⚠️ Considerations & Constraints</h4>
    <ul style="margin-top: 0; padding-left: 0; font-size: 14px; line-height: 1.5; color: #9b2c2c;">
      ${constraintsHtml}
    </ul>
    ` : ''}

    ${stepsHtml ? `
    <h4 style="color: #465f88; margin-top: 24px; margin-bottom: 10px; border-bottom: 1px solid #edf2f7; padding-bottom: 6px; font-size: 15px;">➔ Recommended Next Steps</h4>
    <ul style="margin-top: 0; padding-left: 0; font-size: 14px; line-height: 1.5;">
      ${stepsHtml}
    </ul>
    ` : ''}

    <p style="margin-top: 28px;">${isMicroNode
      ? "Our MicroNode deployment team will follow up shortly to confirm your 15-minute pilot assessment call."
      : "Our infrastructure engineering team will contact you shortly to review these findings and outline next due diligence steps."}</p>
    
    <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 30px 0;" />
    
    <p style="font-size: 14px; color: #718096; margin-bottom: 0; line-height: 1.5;">
      Best regards,<br>
      <strong>Ocean Falls Technology Corp</strong><br>
      ${isMicroNode ? "MicroNode Enterprise AI Team" : "Infrastructure Planning & Development Team"}
    </p>
  </div>
  
  <div style="text-align: center; padding: 20px; font-size: 11px; color: #a0aec0; background-color: #f7fafc; border-top: 1px solid #e2e8f0;">
    This is an automated preliminary evaluation report (${trackBadgeText}). Visit <a href="https://oceanfalls.com" style="color: #465f88; text-decoration: none; font-weight: bold;">oceanfalls.com</a>.
  </div>
</div>
`;

        const subjectPrefix = isMicroNode
          ? "[Ocean Falls — TRACK A: MicroNode Pilot]"
          : "[Ocean Falls — TRACK B: Industrial Power]";

        const ghlPayload = {
          assessment_track: track,
          track_label: trackBadgeText,
          cta_type: ctaTypeLabel,
          readiness_classification: siteDetails.classification,
          readiness_score: siteDetails.calculated_score,
          preferred_pilot_window: body.preferred_window || "",
          company_name: body.company || "",
          contact_name: body.name || "",
          first_name: firstName,
          last_name: lastName,
          email: body.email || "",
          phone: body.phone || "",
          source_url: `https://oceanfalls.com/site-assessment?track=${track}&id=${siteId}`,
          generated_subject: `${subjectPrefix} ${siteDetails.site_name || 'Assessment Report'} (${siteDetails.classification})`,
          generated_body: generatedBody
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

        if (context.waitUntil) {
          context.waitUntil(postPromise);
        } else {
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
