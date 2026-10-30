import { localizedCategoriesIndex } from "../../_lib/catalog-pages.js";
export const onRequestGet = context => localizedCategoriesIndex(context, context.params.locale);
