"use server";

import { getCompanyPageData } from "@/lib/companies/get-company";
import type { CompanyPageData } from "@/lib/companies/types";

export async function getCompanyPageDataAction(slug: string): Promise<CompanyPageData | null> {
  return getCompanyPageData(slug.trim());
}
