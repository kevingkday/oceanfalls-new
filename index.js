import { ensureSchema } from "./functions/api/_schema.js";
import { onRequestPost as assessmentsPost } from "./functions/api/assessments.js";
import { onRequestPost as leadPost } from "./functions/api/lead.js";
import { onRequestPost as loginPost, onRequestGet as loginGet } from "./functions/api/admin/login.js";
import { onRequestGet as sitesGet, onRequestPost as sitesPost } from "./functions/api/admin/sites.js";
import { onRequestGet as mapDatacentresGet } from "./functions/api/map/datacentres.js";
import { 
  onRequestGet as adminDatacentresGet, 
  onRequestPost as adminDatacentresPost, 
  onRequestPut as adminDatacentresPut, 
  onRequestPatch as adminDatacentresPatch, 
  onRequestDelete as adminDatacentresDelete 
} from "./functions/api/admin/datacentres.js";
import { onRequestPost as seedDatacentresPost } from "./functions/api/admin/seed-datacentres.js";

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

    // Build context object matching Cloudflare Pages style
    const context = {
      request,
      env,
      waitUntil: (promise) => ctx.waitUntil(promise)
    };

    // Route to API endpoints
    if (pathname === "/api/assessments" && request.method === "POST") {
      return assessmentsPost(context);
    }
    if (pathname === "/api/lead" && request.method === "POST") {
      return leadPost(context);
    }
    if (pathname === "/api/admin/login") {
      if (request.method === "POST") return loginPost(context);
      if (request.method === "GET") return loginGet(context);
    }
    if (pathname === "/api/admin/sites") {
      if (request.method === "GET") return sitesGet(context);
      if (request.method === "POST") return sitesPost(context);
    }

    // Datacentres Map Endpoints
    if (pathname === "/api/map/datacentres" && request.method === "GET") {
      return mapDatacentresGet(context);
    }

    if (pathname === "/api/admin/datacentres") {
      if (request.method === "GET") return adminDatacentresGet(context);
      if (request.method === "POST") return adminDatacentresPost(context);
      if (request.method === "PUT") return adminDatacentresPut(context);
      if (request.method === "PATCH") return adminDatacentresPatch(context);
      if (request.method === "DELETE") return adminDatacentresDelete(context);
    }

    if (pathname === "/api/admin/seed-datacentres" && request.method === "POST") {
      return seedDatacentresPost(context);
    }

    // Otherwise, serve static assets via the built-in ASSETS binding
    if (env.ASSETS && typeof env.ASSETS.fetch === "function") {
      return env.ASSETS.fetch(request);
    }
    return new Response("Not found", { status: 404 });
  }
};
