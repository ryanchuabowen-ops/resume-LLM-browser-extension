// Local-LLM resume tailoring. Port of job-agent/resume/rewriter_ollama.py.
//
// Pure except for an injected `generate` callback - the actual network call
// happens in background/ollama_client.ts (a local-LLM request can take tens
// of seconds to minutes and must survive the side panel closing mid-request,
// which only the background service worker can guarantee). Keeping this
// file free of direct chrome.* calls also makes it directly Node-testable
// with a stub `generate` function.
//
// Reuses tailorRuleBased for the honest, deterministic part (which bullets
// are relevant, their order, which to highlight) and only asks the LLM to
// reword real bullet items - never job-title/company/date anchor lines,
// which must never be hallucinated. Every rewrite is checked by
// introducesNewNumbers before being accepted; any failure to reach Ollama,
// or a response that isn't parseable JSON, falls back to the pure
// rule-based result rather than crashing or fabricating content.
import type { JobPostingInput } from "../job/types.ts";
import { introducesNewNumbers } from "./numeric_guard.ts";
import type { ResumeDocument } from "./models.ts";
import type { TailoredBullet, TailoredResume } from "./rewriter_base.ts";
import { tailorRuleBased } from "./rewriter_rule_based.ts";

const PROMPT_RULES = `Rules:
- Do NOT invent employers, job titles, dates, skills, or achievements that are not already present or clearly implied in the original bullet.
- Do NOT invent or add ANY numbers, percentages, or metrics that are not already present in the original bullet - not even plausible-sounding ones. If the original has no numbers, the rewrite must have no numbers either.
- Keep each rewritten bullet roughly the same length as the original.
- If a bullet is already a strong match, you may leave it unchanged.
- Output ONLY a JSON object of this exact shape, no other text:
{"bullets": {"0": "rewritten text", "1": "rewritten text"}, "summary": "rewritten 1-2 sentence professional summary"}`;

export function buildPrompt(job: JobPostingInput, candidates: TailoredBullet[]): string {
  const numbered = candidates.map((tb, i) => `${i}: ${tb.original.text}`).join("\n");
  return `You are helping a job applicant tailor their resume bullets to a specific job posting.

Job title: ${job.title}
Company: ${job.company}
Job description:
${(job.description || "").slice(0, 4000)}

Below are the applicant's existing resume bullets, numbered. For each one, rewrite it to better emphasize skills and achievements relevant to this job posting.

${PROMPT_RULES}

Bullets:
${numbered}
`;
}

export interface ParsedOllamaResponse {
  bullets: Map<number, string>;
  summary?: string;
}

export function parseOllamaResponse(rawText: string): ParsedOllamaResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    throw new Error(`Ollama returned unparseable output: ${err instanceof Error ? err.message : String(err)}`);
  }

  const bulletsOut = (parsed as { bullets?: unknown } | null)?.bullets;
  if (!bulletsOut || typeof bulletsOut !== "object") {
    throw new Error("Ollama response missing a 'bullets' object");
  }

  const bullets = new Map<number, string>();
  for (const [key, value] of Object.entries(bulletsOut as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) {
      const idx = Number(key);
      if (!Number.isNaN(idx)) bullets.set(idx, value.trim());
    }
  }

  const summaryRaw = (parsed as { summary?: unknown } | null)?.summary;
  const summary = typeof summaryRaw === "string" && summaryRaw.trim() ? summaryRaw.trim() : undefined;
  return { bullets, summary };
}

export type GenerateFn = (prompt: string) => Promise<string>;

export async function tailorWithOllama(
  resume: ResumeDocument,
  job: JobPostingInput,
  generate: GenerateFn,
): Promise<TailoredResume> {
  const base = tailorRuleBased(resume, job);
  const candidates = base.bullets.filter((tb) => tb.original.isListItem);

  let response: ParsedOllamaResponse;
  try {
    if (candidates.length === 0) throw new Error("No bullet points found to rewrite");
    const rawText = await generate(buildPrompt(job, candidates));
    response = parseOllamaResponse(rawText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      warnings: [...base.warnings, `AI rewriting unavailable (${message}); showing rule-based tailoring only.`],
    };
  }

  const candidateIndex = new Map(candidates.map((tb, i) => [tb, i]));
  let rejectedCount = 0;

  const newBullets: TailoredBullet[] = base.bullets.map((tb) => {
    if (!tb.original.isListItem) return tb;
    const idx = candidateIndex.get(tb)!;
    let newText = response.bullets.get(idx) ?? tb.newText;
    if (introducesNewNumbers(tb.original.text, newText)) {
      rejectedCount++;
      newText = tb.original.text;
    }
    return { ...tb, newText, changed: newText.trim() !== tb.original.text.trim() };
  });

  const warnings = [...base.warnings];
  if (rejectedCount > 0) {
    warnings.push(
      `${rejectedCount} AI-rewritten bullet(s) were reverted to their original wording because the ` +
      `rewrite introduced a number/metric not present in the original - never invented.`,
    );
  }

  let summary = base.summary;
  let summaryChanged = base.summaryChanged;
  if (response.summary) {
    if (introducesNewNumbers(resume.summary, response.summary)) {
      warnings.push("AI-rewritten summary was reverted because it introduced a fabricated number/metric.");
    } else {
      summary = response.summary;
      summaryChanged = summary.trim() !== resume.summary.trim();
    }
  }

  return {
    backendName: "ollama",
    bullets: newBullets,
    summary,
    summaryChanged,
    matchedKeywords: base.matchedKeywords,
    warnings,
  };
}
