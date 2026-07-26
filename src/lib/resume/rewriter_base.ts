// Shared shapes produced by both tailoring backends. Port of
// job-agent/resume/rewriter_base.py.
import type { Bullet } from "./models.ts";

export interface TailoredBullet {
  original: Bullet;
  newText: string;
  changed: boolean; // true only if the wording itself was rewritten (Ollama backend)
  highlight: boolean; // strong keyword match worth visually surfacing
  newOrder: number; // position within its section after tailoring
}

export interface TailoredResume {
  backendName: "rule_based" | "ollama";
  bullets: TailoredBullet[];
  summary: string;
  summaryChanged: boolean;
  matchedKeywords: string[];
  warnings: string[];
}

export function bulletsBySection(tailored: TailoredResume): Map<string, TailoredBullet[]> {
  const map = new Map<string, TailoredBullet[]>();
  for (const tb of tailored.bullets) {
    const list = map.get(tb.original.section);
    if (list) list.push(tb);
    else map.set(tb.original.section, [tb]);
  }
  for (const list of map.values()) list.sort((a, b) => a.newOrder - b.newOrder);
  return map;
}
