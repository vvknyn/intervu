import { cache } from "react";
import { getCompanyPageData } from "./get-company";

/** ONE company load per request, shared by the page, its metadata and its OG image (a second load is a second 200-role search). */
export const loadCompany = cache((slug: string) => getCompanyPageData(slug));
