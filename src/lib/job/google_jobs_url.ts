// Deep-links into Google's Jobs vertical - the standard `ibp=htl;jobs`
// parameter used by ordinary hyperlinks into Google Jobs (the same pattern
// job boards use to link "view more jobs like this on Google"). This is
// just URL construction + a plain tab open - no automation of Google
// itself, no scraping, no DOM reading of the resulting page.
export function buildGoogleJobsUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}&ibp=htl;jobs`;
}
