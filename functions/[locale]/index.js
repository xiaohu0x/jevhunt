import { landing } from "../_lib/catalog-pages.js";
export const onRequestGet = context => ["zh-cn", "zh-tw", "ja", "ko", "es", "fr", "de", "pt-br"].includes(context.params.locale)
  ? landing(context, context.params.locale) : context.next();
