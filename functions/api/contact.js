export async function onRequestPost(context) {
  try {
    const body = await context.request.json();

    // Trigger GoHighLevel Webhook (if URL configured in Cloudflare environment)
    const ghlUrl = context.env.GOHIGHLEVEL_WEBHOOK_URL;
    if (ghlUrl) {
      try {
        await fetch(ghlUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: body.name || "",
            email: body.email || "",
            phone: body.phone || "",
            company: body.company || "",
            interest: body.interest || "",
            message: body.message || "",
            source: "oceanfalls-website-contact",
            submitted_at: new Date().toISOString()
          })
        });
      } catch (webhookErr) {
        console.error("Error triggering GoHighLevel contact webhook:", webhookErr);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: "Inquiry received successfully."
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error("Contact API error:", err);
    return new Response(JSON.stringify({
      success: false,
      message: "Error processing request."
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
