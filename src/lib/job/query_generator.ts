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

// Deliberately its own type, not resume/rewriter_ollama.ts's GenerateFn -
// this feature needs to pass a system-prompt string alongside the user
// prompt (Ollama's /api/generate has a first-class `system` field, which
// behaves differently for many models than folding the same instructions
// into the user prompt), and tailoring doesn't need that, so there's no
// reason to widen its shared type.
export type QueryGenerateFn = (prompt: string, system?: string) => Promise<string>;

const DEFAULT_QUERY_COUNT = 6;
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

// Requiring just ONE shared word is too weak a bar: a weak model that mostly
// parrots the prompt's few-shot example (rather than generalizing it to the
// actual resume) can still accidentally share a single common word - "senior"
// or "python" - with the real resume while describing an entirely different,
// fabricated role. Observed live: qwen2:0.5b returned "senior data analyst
// jobs" for a backend engineer's resume, which slipped past a single-word
// check via the shared word "senior" alone. Requiring most of the query's
// words to overlap catches this without rejecting genuinely resume-grounded
// short queries, since those are built FROM resume content in the first place.
const MIN_OVERLAP_RATIO = 0.5;

function overlapRatio(query: string, resumeWords: Set<string>): number {
  const queryWords = [...wordSet(query)];
  if (queryWords.length === 0) return 0;
  const matched = queryWords.filter((w) => resumeWords.has(w)).length;
  return matched / queryWords.length;
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
  // Pull enough skills to build several genuinely distinct queries rather
  // than padding the list with near-duplicates once count grows past 4.
  const topSkills = extractSkillKeywords(resume, Math.max(6, count));

  const candidates: string[] = [];
  if (title) candidates.push(`${title} jobs`);
  if (title) candidates.push(`remote ${title} jobs`);
  if (title && topSkills.length > 0) candidates.push(`${title} ${topSkills.slice(0, 2).join(" ")} jobs`);
  if (title && topSkills.length > 2) candidates.push(`${title} ${topSkills.slice(2, 4).join(" ")} jobs`);
  if (topSkills.length > 0) candidates.push(`${topSkills.slice(0, 3).join(" ")} jobs`);
  if (topSkills.length > 3) candidates.push(`${topSkills.slice(3, 6).join(" ")} jobs`);
  // One query per top skill on its own - gives breadth once more than 4
  // queries are requested, without inventing anything not on the resume.
  for (const skill of topSkills.slice(0, count)) {
    candidates.push(`${skill} jobs`);
  }
  if (candidates.length === 0 && topSkills.length === 0) {
    const fallbackKeywords = extractKeywords(flattenResumeText(resume), 3);
    if (fallbackKeywords.length > 0) candidates.push(`${fallbackKeywords.join(" ")} jobs`);
  }

  return dedupeAndCap(candidates, count);
}

// A dedicated system prompt (passed via Ollama's `system` field, not folded
// into the user prompt) - many models weight system-level instructions more
// strongly for formatting/behavioral constraints than the same text placed
// in the user turn.
export const QUERY_SYSTEM_MESSAGE =
  "You are a precise search-query generator for a job search tool. You only ever output a single " +
  "valid JSON object and nothing else - no explanations, no markdown code fences, no apologies, " +
  "no commentary before or after the JSON.";

// A concrete worked example, not just prose rules - small/weak models in
// particular follow a shown example far more reliably than an abstract
// instruction like "keep queries short."
const FEW_SHOT_EXAMPLE = `Example resume:
Most recent title: "Senior Data Analyst"
Experience: Built dashboards for executive reporting using SQL and Tableau. Automated ETL pipelines with Python and Airflow. Used Power BI for stakeholder reporting.

Example good output for 6 queries:
{"queries": ["senior data analyst jobs", "remote data analyst jobs", "data analyst SQL Tableau jobs", "data analyst Python Airflow jobs", "SQL Tableau Power BI jobs", "Python ETL jobs"]}`;

export function buildQueryPrompt(resume: ResumeDocument, count: number): string {
  const flat = flattenResumeText(resume).trim().slice(0, 4000);
  const title = mostRecentJobTitle(resume);

  return `Generate ${count} distinct Google Jobs search queries for this job seeker, based only on the resume below.

Rules:
- Each query must be 2 to 6 words long, not counting the word "jobs" itself. Short and natural, like something a person would actually type into Google.
- Combine at most 2 skills in a single query - never chain three or more skills together into one query.
- Plain words separated by spaces only. No quotation marks, parentheses, commas, or words like AND/OR.
- Base every query ONLY on skills, job titles, and experience that actually appear in the resume below - never invent a role or skill that isn't shown.
- Vary the angle across the ${count} queries: plain title, title with 1-2 top skills, skills alone, and a remote-friendly variant.

${FEW_SHOT_EXAMPLE}

Now do the same for this resume.
${title ? `Most recent title: "${title}"\n` : ""}Experience: ${flat}

Output ONLY a JSON object of this exact shape, no other text:
{"queries": ["query one", "query two"]}`;
}

// Small/weak models frequently ignore "output ONLY JSON" - wrapping the
// object in a markdown code fence, or padding it with a sentence of
// preamble/apology despite format:"json". Rather than failing outright (and
// leaving the user unable to see what the model actually said), this tries
// a direct parse first and falls back to extracting the first {...} or
// [...] substring found anywhere in the text.
function extractJsonCandidate(rawText: string): string {
  const trimmed = rawText.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1]!.trim() : trimmed;
  const objectMatch = candidate.match(/\{[\s\S]*\}/);
  if (objectMatch) return objectMatch[0];
  const arrayMatch = candidate.match(/\[[\s\S]*\]/);
  if (arrayMatch) return arrayMatch[0];
  return candidate;
}

export function parseQueriesResponse(rawText: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonCandidate(rawText));
  } catch (err) {
    throw new Error(`Could not parse query suggestions: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Tolerate a bare array too - some small models forget the {"queries": [...]} wrapper.
  const queriesRaw = Array.isArray(parsed) ? parsed : (parsed as { queries?: unknown } | null)?.queries;
  if (!Array.isArray(queriesRaw)) {
    throw new Error("Response missing a 'queries' array");
  }
  return queriesRaw
    .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
    .map((q) => q.trim());
}

export interface QueryGenerationResult {
  queries: string[];
  warnings: string[];
  /** AI suggestions that were dropped for not overlapping the resume at all -
   * surfaced (not hidden) so a low-quality model's actual output is visible
   * rather than silently disappearing. */
  droppedQueries: string[];
}

export async function generateQueriesWithOllama(
  resume: ResumeDocument,
  generate: QueryGenerateFn,
  count = DEFAULT_QUERY_COUNT,
): Promise<QueryGenerationResult> {
  const fallbackQueries = generateQueriesRuleBased(resume, count);

  let rawQueries: string[];
  try {
    const rawText = await generate(buildQueryPrompt(resume, count), QUERY_SYSTEM_MESSAGE);
    rawQueries = parseQueriesResponse(rawText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      queries: fallbackQueries,
      warnings: [`AI query generation unavailable (${message}); showing rule-based suggestions only.`],
      droppedQueries: [],
    };
  }

  const resumeWords = wordSet(flattenResumeText(resume));
  const accepted: string[] = [];
  const dropped: string[] = [];
  for (const q of rawQueries) {
    if (overlapRatio(q, resumeWords) >= MIN_OVERLAP_RATIO) accepted.push(q);
    else dropped.push(q);
  }

  const warnings: string[] = [];
  if (dropped.length > 0) {
    warnings.push(
      `${dropped.length} suggested quer${dropped.length === 1 ? "y" : "ies"} ` +
      `${dropped.length === 1 ? "was" : "were"} dropped for mostly not matching your resume (shown below).`,
    );
  }

  if (accepted.length === 0) {
    warnings.push(
      rawQueries.length === 0
        ? "The model's response didn't contain any usable queries (likely too small/weak for this task); showing rule-based suggestions instead."
        : "AI suggestions didn't look related to your resume; showing rule-based suggestions instead.",
    );
    return { queries: fallbackQueries, warnings, droppedQueries: dropped };
  }

  return { queries: dedupeAndCap(accepted, count), warnings, droppedQueries: dropped };
}
