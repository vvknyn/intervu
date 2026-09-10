/** Request header middleware sets when `/jobs` carries query params so
 *  `app/jobs/layout.tsx`'s `generateMetadata` can emit matching noindex meta. */
export const JOBS_QUERY_HEADER = "x-velai-jobs-query";
