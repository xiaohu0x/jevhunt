/** Canonicalize HTML/API requests; static assets bypass Functions via _routes. */
export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.hostname === "www.jevhunt.com") {
    url.hostname = "jevhunt.com";
    url.protocol = "https:";
    return Response.redirect(url.href, 308);
  }
  return context.next();
}
