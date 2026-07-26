// Heuristic section-header detection, shared by the DOCX and PDF parsers.
// Port of job-agent/resume/parser.py's _looks_like_section_header / _SECTION_NAMES.

const SECTION_NAMES = new Set([
  "summary", "objective", "profile", "about",
  "experience", "work experience", "professional experience", "employment",
  "education", "skills", "technical skills", "projects", "certifications",
  "awards", "publications", "volunteer", "volunteering", "languages",
  "interests", "activities", "leadership",
]);

const SUMMARY_LIKE = new Set(["summary", "objective", "profile", "about"]);

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Returns a normalized section name if `line` looks like a section header, else null. */
export function looksLikeSectionHeader(line: string): string | null {
  const stripped = line.trim().replace(/:+$/, "");
  if (!stripped || stripped.length > 40) return null;

  const lowered = stripped.toLowerCase();
  if (SECTION_NAMES.has(lowered)) return titleCase(stripped);

  // ALL CAPS short line containing a known section word (common resume header style)
  if (stripped === stripped.toUpperCase() && /[A-Z]/.test(stripped)) {
    for (const word of SECTION_NAMES) {
      if (lowered.includes(word)) return titleCase(stripped);
    }
  }
  return null;
}

export function isSummaryLikeSection(name: string): boolean {
  return SUMMARY_LIKE.has(name.toLowerCase());
}
