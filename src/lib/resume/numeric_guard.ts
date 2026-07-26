// Hard safety net against LLM-fabricated numbers. Port of
// job-agent/resume/rewriter_ollama.py's _introduces_new_numbers.
//
// LLMs reliably invent plausible-sounding metrics ("increased efficiency by
// 25%") even when explicitly told not to - this was caught live: Mistral-Nemo
// invented a fake "25% efficiency increase" on a bullet that had no numbers
// at all, despite an explicit prompt instruction not to. This is a
// structural check, not a prompt instruction, because a fabricated metric on
// a real job application is a serious honesty problem, not just a style
// issue. DO NOT remove or weaken this in favor of "the prompt already says
// not to."

const NUMBER_RE = /\d[\d,.]*%?\+?/g;

export function introducesNewNumbers(original: string, rewritten: string): boolean {
  const originalNumbers = new Set(original.match(NUMBER_RE) ?? []);
  const rewrittenNumbers = rewritten.match(NUMBER_RE) ?? [];
  return rewrittenNumbers.some((n) => !originalNumbers.has(n));
}
