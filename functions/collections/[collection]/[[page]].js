import { collectionPage } from "../../_lib/catalog-pages.js";
export const onRequestGet = context => collectionPage(context, context.params.collection);
