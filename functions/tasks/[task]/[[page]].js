import { taskPage } from "../../_lib/catalog-pages.js";
export const onRequestGet = context => taskPage(context, context.params.task);
