import { extractJobDescription, type ExtractResult } from "../lib/job/extract.ts";

export function extractFromCurrentPage(): ExtractResult {
  return extractJobDescription(document, location.hostname);
}
