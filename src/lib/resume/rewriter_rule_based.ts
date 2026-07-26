// Offline, no-LLM resume tailoring. Port of job-agent/resume/rewriter_rule_based.py.
// Scores each bullet by keyword overlap with the job description, then
// reorders (best matches first) and highlights - never invents or rewords.
//
// Reordering only happens *within* contiguous runs of real list-item
// bullets - it never moves a plain line like a "Job Title, Company" header,
// and never lets bullets hop across such a header into a different job's
// bullet list. This guarantee exists because, without it, a multi-job
// "Experience" section would get its bullets shuffled across employers,
// misattributing achievements to the wrong job. DO NOT weaken this.
import { extractKeywords, scoreTextAgainstKeywords } from "./keyword_extract.ts";
import type { Bullet, ResumeDocument } from "./models.ts";
import type { TailoredBullet, TailoredResume } from "./rewriter_base.ts";
import type { JobPostingInput } from "../job/types.ts";

const HIGHLIGHT_TOP_N_PER_RUN = 3;

/** Splits a section's bullets into runs, where each run is either a single
 * non-list anchor line, or a contiguous block of real list items. */
export function segmentListRuns(bullets: Bullet[]): Bullet[][] {
  const runs: Bullet[][] = [];
  let current: Bullet[] = [];
  for (const b of bullets) {
    if (b.isListItem) {
      current.push(b);
    } else {
      if (current.length > 0) {
        runs.push(current);
        current = [];
      }
      runs.push([b]);
    }
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

export function tailorRuleBased(resume: ResumeDocument, job: JobPostingInput): TailoredResume {
  const keywords = extractKeywords(job.description);
  const tailoredBullets: TailoredBullet[] = [];

  for (const section of resume.sections) {
    let newOrder = 0;
    for (const run of segmentListRuns(section.bullets)) {
      const isAnchor = run.length === 1 && !run[0]!.isListItem;
      if (isAnchor) {
        tailoredBullets.push({
          original: run[0]!,
          newText: run[0]!.text,
          changed: false,
          highlight: false,
          newOrder: newOrder++,
        });
        continue;
      }

      const scored = run
        .map((bullet) => ({ bullet, score: scoreTextAgainstKeywords(bullet.text, keywords) }))
        .sort((a, b) => b.score - a.score); // stable sort: ties keep original relative order

      scored.forEach(({ bullet, score }, rank) => {
        const highlight = score > 0 && rank < HIGHLIGHT_TOP_N_PER_RUN;
        tailoredBullets.push({
          original: bullet,
          newText: bullet.text,
          changed: false,
          highlight,
          newOrder: newOrder++,
        });
      });
    }
  }

  const warnings: string[] = [];
  if (keywords.length === 0) {
    warnings.push("Could not extract keywords from the job description; bullets left in original order.");
  }

  return {
    backendName: "rule_based",
    bullets: tailoredBullets,
    summary: resume.summary,
    summaryChanged: false,
    matchedKeywords: keywords,
    warnings,
  };
}
