import { ensureSchema } from "./functions/api/_schema.js";
import { onRequestPost as assessmentsPost } from "./functions/api/assessments.js";
import { onRequestPost as leadPost } from "./functions/api/lead.js";
import { onRequestPost as loginPost, onRequestGet as loginGet } from "./functions/api/admin/login.js";
import { onRequestGet as sitesGet, onRequestPost as sitesPost } from "./functions/api/admin/sites.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Ensure database is initialized on every API request
    if (pathname.startsWith("/api/")) {
      try {
        await ensureSchema(env.DB);
      } catch (err) {
        console.error("Database schema init error:", err);
      }
    }

    // Route to API endpoints
    if (pathname === "/api/assessments" && request.method === "POST") {
      return assessmentsPost({ request, env });
    }
    if (pathname === "/api/lead" && request.method === "POST") {
      return leadPost({ request, env });
    }
    if (pathname === "/api/admin/login") {
      if (request.method === "POST") return loginPost({ request, env });
      if (request.method === "GET") return loginGet({ request, env });
    }
    if (pathname === "/api/admin/sites") {
      if (request.method === "GET") return sitesGet({ request, env });
      if (request.method === "POST") return sitesPost({ request, env });
    }

    // Otherwise, serve static assets via the built-in ASSETS binding
    return env.ASSETS.fetch(request);
  }
};
