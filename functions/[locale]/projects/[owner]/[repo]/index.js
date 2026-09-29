import { projectPage } from "../../../../_lib/catalog-pages.js";
import { LOCALES } from "../../../../../shared/locales.js";

export const onRequestGet = context => Object.hasOwn(LOCALES, context.params.locale) && context.params.locale !== "en"
  ? projectPage(context, context.params.locale)
  : context.next();
