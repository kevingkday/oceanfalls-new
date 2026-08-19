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
    
    // 3. Fetch detailed site data & assessment results to build the email report
    let siteDetails = null;
    try {
      siteDetails = await db.prepare(`
        SELECT 
          s.name as site_name, s.city, s.province_state, s.country, s.acreage, s.current_use, s.ownership_status, s.opportunity_type, s.target_size_mw,
          p.firm_power_available_mw, p.max_potential_capacity_mw, p.power_type, p.delivered_cost_mwh,
          c.diverse_routes, c.fibre_available,
          d.zoning, d.data_centre_permitted,
          r.classification, r.calculated_score, r.confidence_level, r.key_strengths, r.verification_issues, r.potential_constraints, r.recommended_steps
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

        // Build premium, email-ready HTML body
        const generatedBody = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #283439; line-height: 1.6; border: 1px solid #e2e8f0; border-radius: 0px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
  <div style="background-color: #465f88; padding: 32px 24px; text-align: center; color: white;">
    <h1 style="margin: 0; font-size: 26px; font-weight: bold; letter-spacing: -0.5px;">Ocean Falls Technology</h1>
    <p style="margin: 6px 0 0 0; font-size: 13px; opacity: 0.9; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 600;">Infrastructure Site Assessment</p>
  </div>
  
  <div style="padding: 32px 24px; background-color: #ffffff;">
    <p style="font-size: 16px; margin-top: 0;">Dear ${body.name || "Partner"},</p>
    
    <p>Thank you for submitting your site for assessment. We have successfully received your inquiry and our infrastructure team is currently conducting a detailed review of the property parameters.</p>
    
    <div style="background-color: #f7fafc; border-left: 4px solid #465f88; padding: 20px; margin: 24px 0; border-radius: 0px;">
      <h3 style="margin-top: 0; margin-bottom: 12px; color: #465f88; font-size: 16px; text-transform: uppercase; letter-spacing: 0.5px;">Preliminary Evaluation Result</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr>
          <td style="padding: 6px 0; font-weight: bold; width: 40%; color: #718096;">Property:</td>
          <td style="padding: 6px 0; font-weight: 600; color: #2d3748;">${siteDetails.site_name || "Unspecified Property"}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-weight: bold; color: #718096;">Classification:</td>
          <td style="padding: 6px 0; font-weight: bold; color: ${siteDetails.classification === 'Promising' ? '#2f855a' : siteDetails.classification === 'Conditional' ? '#c05621' : '#c53030'};">${siteDetails.classification}</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-weight: bold; color: #718096;">Calculated Score:</td>
          <td style="padding: 6px 0; font-weight: bold; color: #2d3748; font-size: 16px;">${siteDetails.calculated_score} / 100</td>
        </tr>
        <tr>
          <td style="padding: 6px 0; font-weight: bold; color: #718096;">Confidence Rating:</td>
          <td style="padding: 6px 0; color: #2d3748;">${siteDetails.confidence_level}</td>
        </tr>
      </table>
    </div>

    ${strengthsHtml ? `
    <h4 style="color: #465f88; margin-top: 24px; margin-bottom: 10px; border-bottom: 1px solid #edf2f7; padding-bottom: 6px; font-size: 15px;">✔️ Key Strengths</h4>
    <ul style="margin-top: 0; padding-left: 0; font-size: 14px; line-height: 1.5;">
      ${strengthsHtml}
    </ul>
    ` : ''}

    ${issuesHtml ? `
    <h4 style="color: #465f88; margin-top: 24px; margin-bottom: 10px; border-bottom: 1px solid #edf2f7; padding-bottom: 6px; font-size: 15px;">🔍 Due Diligence & Unverified Items</h4>
    <ul style="margin-top: 0; padding-left: 0; font-size: 14px; line-height: 1.5;">
      ${issuesHtml}
    </ul>
    ` : ''}

    ${constraintsHtml ? `
    <h4 style="color: #c53030; margin-top: 24px; margin-bottom: 10px; border-bottom: 1px solid #fed7d7; padding-bottom: 6px; font-size: 15px;">⚠️ Potential Constraints</h4>
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

    <p style="margin-top: 28px;">Our engineering team will contact you shortly to review these findings and outline any necessary due diligence steps.</p>
    
    <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 30px 0;" />
    
    <p style="font-size: 14px; color: #718096; margin-bottom: 0; line-height: 1.5;">
      Best regards,<br>
      <strong>Ocean Falls Technology Corp</strong><br>
      Infrastructure Planning & Development Team
    </p>
  </div>
  
  <div style="text-align: center; padding: 20px; font-size: 11px; color: #a0aec0; background-color: #f7fafc; border-top: 1px solid #e2e8f0;">
    This is an automated preliminary evaluation report. If you have questions, please reply directly or visit <a href="https://oceanfalls.com" style="color: #465f88; text-decoration: none; font-weight: bold;">oceanfalls.com</a>.
  </div>
</div>
`;

        // Map payload strictly to matches user's request sample
        const ghlPayload = {
          company_name: body.company || "",
          contact_name: body.name || "",
          first_name: firstName,
          last_name: lastName,
          email: body.email || "",
          phone: body.phone || "",
          source_url: `https://oceanfalls-new.kevin-c8e.workers.dev/site-assessment?id=${siteId}`,
          generated_subject: `[Ocean Falls] Site Assessment Report: ${siteDetails.site_name || 'Property'}`,
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

        // Use waitUntil if available so the client request isn't blocked
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
