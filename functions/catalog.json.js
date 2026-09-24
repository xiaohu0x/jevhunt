import { onRequestGet as catalog } from "./api/catalog.js";
export function onRequestGet(context) {
  const url = new URL(context.request.url); url.searchParams.set("all", "1"); url.searchParams.set("full", "1");
  return catalog({ ...context, request: new Request(url, context.request) });
}
