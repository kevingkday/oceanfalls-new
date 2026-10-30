import { ensureSchema } from "./_schema.js";

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const rawEmail = (body.email || "").trim().toLowerCase();
    const name = (body.name || "").trim();
    const source = (body.source || "oceanfalls-website").trim();

    if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      return new Response(JSON.stringify({
        success: false,
        message: "Please enter a valid email address."
      }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const now = new Date().toISOString();
    let buttondownStatus = "pending";
    let alreadySubscribed = false;

    // 1. Forward to Buttondown API if BUTTONDOWN_API_KEY is configured
    const apiKey = (context.env && context.env.BUTTONDOWN_API_KEY) ? context.env.BUTTONDOWN_API_KEY.trim() : "";

    if (apiKey) {
      const metadata = {};
      if (name) metadata.name = name;
      if (source) metadata.source = source;

      const payloadV1 = {
        email_address: rawEmail,
        tags: ["oceanfalls", source],
        notes: name ? `Name: ${name} (${source})` : `Subscribed via ${source}`,
        metadata
      };

      let bdRes = await fetch("https://api.buttondown.com/v1/subscribers", {
        method: "POST",
        headers: {
          "Authorization": `Token ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payloadV1)
      });

      let bdText = await bdRes.text();
      let bdData = {};
      try { bdData = JSON.parse(bdText); } catch (e) {}

      // Fallback if Buttondown account is pinned to older API expecting `email` instead of `email_address`
      if (bdRes.status === 422 && bdText.includes('"email"') && !bdText.includes("already")) {
        const payloadLegacy = {
          email: rawEmail,
          tags: ["oceanfalls", source],
          notes: name ? `Name: ${name} (${source})` : `Subscribed via ${source}`,
          metadata
        };
        bdRes = await fetch("https://api.buttondown.com/v1/subscribers", {
          method: "POST",
          headers: {
            "Authorization": `Token ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payloadLegacy)
        });
        bdText = await bdRes.text();
        try { bdData = JSON.parse(bdText); } catch (e) {}
      }

      if (bdRes.ok) {
        buttondownStatus = "subscribed";
      } else {
        const lowerErr = bdText.toLowerCase();
        if (
          lowerErr.includes("already") ||
          lowerErr.includes("exists") ||
          lowerErr.includes("subscribed") ||
          bdData?.code === "email_already_exists" ||
          bdData?.code === "subscriber_already_exists"
        ) {
          buttondownStatus = "already_subscribed";
          alreadySubscribed = true;
        } else {
          console.error("Buttondown API error:", bdRes.status, bdText);
          buttondownStatus = `error_${bdRes.status}`;
        }
      }
    } else {
      console.warn("BUTTONDOWN_API_KEY is not configured in environment; saving subscriber to D1 only.");
      buttondownStatus = "saved_local_only";
    }

    // 2. Persist subscriber to Cloudflare D1 as backup & internal record
    if (context.env && context.env.DB) {
      try {
        await ensureSchema(context.env.DB);
        await context.env.DB.prepare(`
          INSERT INTO newsletter_subscribers (email, name, source, buttondown_status, created_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(email) DO UPDATE SET
            name = CASE WHEN excluded.name != '' THEN excluded.name ELSE newsletter_subscribers.name END,
            source = excluded.source,
            buttondown_status = excluded.buttondown_status
        `).bind(rawEmail, name, source, buttondownStatus, now).run();
      } catch (dbErr) {
        console.error("Error saving subscriber to D1:", dbErr);
      }
    }

    // If Buttondown failed with a hard error (e.g. invalid API key or blocked email) and wasn't just already subscribed
    if (buttondownStatus.startsWith("error_")) {
      return new Response(JSON.stringify({
        success: false,
        message: "We could not complete your subscription right now. Please check your email address and try again."
      }), {
        status: 502,
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      already_subscribed: alreadySubscribed,
      message: alreadySubscribed
        ? "You are already subscribed to Ocean Falls intelligence briefings."
        : "Thank you for subscribing. Check your inbox to confirm your subscription."
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error("Newsletter subscription error:", err);
    return new Response(JSON.stringify({
      success: false,
      message: "An unexpected error occurred. Please try again."
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

