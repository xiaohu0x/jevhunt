import { localizedTasksIndex } from "../../_lib/catalog-pages.js";
export const onRequestGet = context => localizedTasksIndex(context, context.params.locale);
