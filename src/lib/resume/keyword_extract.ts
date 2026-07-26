// Pure keyword extraction from a job description. Port of
// job-agent/resume/keyword_extract.py. Deliberately no NLP library - a
// curated stopword list and frequency scoring is enough for "which of my
// existing bullets overlap with this posting."

const STOPWORDS = new Set(`
a an the and or but if while with without within into onto from to of for on
in at by as is are was were be been being this that these those it its it's
you your you're we our us they their them he she his her i me my mine
will would should could can may might must shall not no nor so than then
there here when where why how what which who whom
job role position company team we're looking seeking candidate candidates
years experience year required requirements responsibilities responsibility
including include includes strong ability able work working works
must have preferred plus etc across various other any all more most
per day week month annually salary range benefits equal opportunity employer
apply application applicants qualified qualifications minimum
new join joining help helping using use used
`.split(/\s+/).filter(Boolean));

const WORD_RE = /[A-Za-z][A-Za-z0-9+/#.-]{1,}/g;

export function extractKeywords(text: string, topN = 40): string[] {
  if (!text) return [];
  const words = text.match(WORD_RE) ?? [];
  const counts = new Map<string, number>();
  for (const raw of words) {
    const word = raw.toLowerCase().replace(/^[.-]+|[.-]+$/g, "");
    if (word.length <= 2 || STOPWORDS.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word]) => word);
}

export function scoreTextAgainstKeywords(text: string, keywords: string[]): number {
  if (!text || keywords.length === 0) return 0;
  const lowered = text.toLowerCase();
  return keywords.reduce((count, kw) => count + (lowered.includes(kw) ? 1 : 0), 0);
}
