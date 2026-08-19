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
    
    // Update the contacts table for the site
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
    
    // Also set lead status to 'New' to trigger notice
    await db.prepare(`
      UPDATE sites
      SET lead_status = 'New'
      WHERE id = ?
    `).bind(siteId).run();
    
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
