import { localizedTaskPage } from "../../../_lib/catalog-pages.js";
export const onRequestGet = context => localizedTaskPage(context, context.params.locale, context.params.task);
