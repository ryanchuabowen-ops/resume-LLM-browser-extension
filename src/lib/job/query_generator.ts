// Generates Google-Jobs-style search queries from the user's own resume -
// no scraping, no job discovery inside the extension. The extension only
// crafts search text and opens a normal Google Jobs tab for the user to
// browse themselves (see google_jobs_url.ts).
//
// Mirrors resume/rewriter_ollama.ts's shape: pure prompt-building/response-
// parsing/fallback logic here, with the actual network call injected as a
// `generate` callback so this stays Node-testable and free of direct
// chrome.* calls. Same honesty posture as the numeric-fabrication guard,
// adapted for free text (which can't be regex-checked the way numbers can):
// any generated query with zero word-overlap against the resume's own text
// is dropped, on the theory that it likely invented a role/skill never
// mentioned.
import { extractKeywords } from "../resume/keyword_extract.ts";
import type { ResumeDocument } from "../resume/models.ts";
import type { GenerateFn } from "../resume/rewriter_ollama.ts";

const DEFAULT_QUERY_COUNT = 4;
const WORD_RE = /[a-z0-9]+/g;
const MIN_WORD_LENGTH = 3;

// extractKeywords() ranks purely by frequency, and most resume skill mentions
// only occur once each - so ties are broken by first-occurrence in the text,
// which silently favors generic resume language (role words, action verbs,
// domain nouns) over the actual distinct skill terms a "top skills" query
// needs. Rather than a fragile capitalization heuristic (technology names
// aren't reliably capitalized - "gRPC", "iOS" break a naive uppercase-first
// check), this excludes a known, bounded set of generic resume vocabulary
// from the skill-keyword candidates.
const GENERIC_RESUME_WORDS = new Set([
  "built", "led", "managed", "developed", "created", "designed", "implemented",
  "improved", "increased", "reduced", "launched", "delivered", "drove", "owned",
  "architected", "mentored", "collaborated", "coordinated", "organized", "service",
  "services", "team", "teams", "worked", "using", "migration", "project", "projects",
  "engineer", "engineering", "backend", "frontend", "senior", "junior", "specializing",
  "distributed", "systems", "system", "years", "experience",
]);

function flattenResumeText(resume: ResumeDocument): string {
  const bulletText = resume.sections.flatMap((s) => s.bullets.map((b) => b.text)).join(" ");
  return `${resume.summary} ${bulletText}`;
}

// Anchor lines (job title/company) repeat generic role words like "backend"
// and "engineer" - mostRecentJobTitle() already captures those separately,
// so including anchors here would let repeated role words outrank the
// actual distinct skill keywords. Keyword extraction for the "top skills"
// queries deliberately only looks at real bullet content, not anchor lines
// or the summary (which tends toward narrative role-description language).
function flattenSkillText(resume: ResumeDocument): string {
  return resume.sections
    .flatMap((s) => s.bullets.filter((b) => b.isListItem).map((b) => b.text))
    .join(" ");
}

function extractSkillKeywords(resume: ResumeDocument, topN: number): string[] {
  return extractKeywords(flattenSkillText(resume), topN * 3).filter((k) => !GENERIC_RESUME_WORDS.has(k)).slice(0, topN);
}

function wordSet(text: string): Set<string> {
  const words = text.toLowerCase().match(WORD_RE) ?? [];
  return new Set(words.filter((w) => w.length >= MIN_WORD_LENGTH));
}

/** Title portion (before the first comma) of the first anchor line found,
 * e.g. "Senior Software Engineer" from "Senior Software Engineer, Acme Corp (2021-Present)". */
export function mostRecentJobTitle(resume: ResumeDocument): string | null {
  for (const section of resume.sections) {
    for (const bullet of section.bullets) {
      if (bullet.isListItem) continue;
      const commaIdx = bullet.text.indexOf(",");
      const title = (commaIdx === -1 ? bullet.text : bullet.text.slice(0, commaIdx)).trim();
      if (title) return title;
    }
  }
  return null;
}

function dedupeAndCap(candidates: string[], count: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of candidates) {
    const q = raw.trim();
    const key = q.toLowerCase();
    if (!q || seen.has(key)) continue;
    seen.add(key);
    result.push(q);
    if (result.length >= count) break;
  }
  return result;
}

export function generateQueriesRuleBased(resume: ResumeDocument, count = DEFAULT_QUERY_COUNT): string[] {
  const title = mostRecentJobTitle(resume);
  const topSkills = extractSkillKeywords(resume, 3);

  const candidates: string[] = [];
  if (title) candidates.push(`${title} jobs`);
  if (title && topSkills.length > 0) candidates.push(`${title} ${topSkills.slice(0, 2).join(" ")} jobs`);
  if (topSkills.length > 0) candidates.push(`${topSkills.join(" ")} jobs`);
  if (title) candidates.push(`remote ${title} jobs`);
  if (candidates.length === 0 && topSkills.length === 0) {
    const fallbackKeywords = extractKeywords(flattenResumeText(resume), 3);
    if (fallbackKeywords.length > 0) candidates.push(`${fallbackKeywords.join(" ")} jobs`);
  }

  return dedupeAndCap(candidates, count);
}

export function buildQueryPrompt(resume: ResumeDocument, count: number): string {
  const flat = flattenResumeText(resume).trim().slice(0, 4000);
  return `You are helping a job seeker find relevant job postings on Google based on their resume.

Resume summary and experience (for context only - do not quote it verbatim):
${flat}

Generate ${count} distinct Google Jobs search queries that this person could use to find relevant jobs.

Rules:
- Base every query ONLY on skills, job titles, and experience that actually appear in the resume above - do not invent roles or skills not shown.
- Vary the angle across queries: different job title phrasing, different skill emphasis, a remote-friendly variant, etc.
- Keep each query short and natural, like something a person would actually type into Google (e.g. "senior backend engineer python kubernetes jobs").
- Output ONLY a JSON object of this exact shape, no other text:
{"queries": ["query one", "query two"]}
`;
}

export function parseQueriesResponse(rawText: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    throw new Error(`Could not parse query suggestions: ${err instanceof Error ? err.message : String(err)}`);
  }
  const queries = (parsed as { queries?: unknown } | null)?.queries;
  if (!Array.isArray(queries)) {
    throw new Error("Response missing a 'queries' array");
  }
  return queries
    .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
    .map((q) => q.trim());
}

export interface QueryGenerationResult {
  queries: string[];
  warnings: string[];
}

export async function generateQueriesWithOllama(
  resume: ResumeDocument,
  generate: GenerateFn,
  count = DEFAULT_QUERY_COUNT,
): Promise<QueryGenerationResult> {
  const fallbackQueries = generateQueriesRuleBased(resume, count);

  let rawQueries: string[];
  try {
    const rawText = await generate(buildQueryPrompt(resume, count));
    rawQueries = parseQueriesResponse(rawText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      queries: fallbackQueries,
      warnings: [`AI query generation unavailable (${message}); showing rule-based suggestions only.`],
    };
  }

  const resumeWords = wordSet(flattenResumeText(resume));
  const accepted: string[] = [];
  let droppedCount = 0;
  for (const q of rawQueries) {
    const queryWords = wordSet(q);
    const overlaps = [...queryWords].some((w) => resumeWords.has(w));
    if (overlaps) accepted.push(q);
    else droppedCount++;
  }

  const warnings: string[] = [];
  if (droppedCount > 0) {
    warnings.push(
      `${droppedCount} suggested quer${droppedCount === 1 ? "y" : "ies"} were dropped for not matching anything in your resume.`,
    );
  }

  if (accepted.length === 0) {
    warnings.push("AI suggestions didn't look related to your resume; showing rule-based suggestions instead.");
    return { queries: fallbackQueries, warnings };
  }

  return { queries: dedupeAndCap(accepted, count), warnings };
}
