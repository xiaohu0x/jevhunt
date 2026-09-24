import { json } from "../_lib/auth.js";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.hostname === "www.jevhunt.com") {
    url.hostname = "jevhunt.com";
    return Response.redirect(url.toString(), 308);
  }
  try {
    const response = await context.next();
    if (!url.pathname.startsWith("/api/")) return response;
    const safe = new Response(response.body, response);
    if (url.pathname !== "/api/catalog") safe.headers.set("Cache-Control", "no-store");
    safe.headers.set("X-Content-Type-Options", "nosniff");
    safe.headers.set("Referrer-Policy", "same-origin");
    return safe;
  } catch (error) {
    console.error("request failed", error?.name || "Error");
    if (url.pathname.startsWith("/api/")) return json({ error: "service_unavailable" }, { status: 503, headers: { "Retry-After": "30" } });
    throw error;
  }
}
