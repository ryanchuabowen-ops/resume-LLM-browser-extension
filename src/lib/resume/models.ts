// In-memory representation of a parsed resume, independent of source format.
// Port of job-agent/resume/models.py.

export type SourceFormat = "pdf" | "docx";

export interface Bullet {
  text: string;
  section: string;
  order: number;
  // False for plain lines like "Senior Engineer, Acme Corp (2021-Present)" -
  // these anchor reordering and must never be treated as a scoreable bullet.
  // See rewriter_rule_based.ts's segmentListRuns, which depends on this flag.
  isListItem: boolean;
  styleName?: string;
}

export interface Section {
  name: string;
  bullets: Bullet[];
}

export interface ResumeDocument {
  contactBlock: string;
  summary: string;
  sections: Section[];
  sourceFormat: SourceFormat;
  sourceFileName: string;
}

export function findSection(doc: ResumeDocument, name: string): Section | undefined {
  const lowered = name.toLowerCase();
  return doc.sections.find((s) => s.name.toLowerCase() === lowered);
}

export function allBullets(doc: ResumeDocument): Bullet[] {
  return doc.sections.flatMap((s) => s.bullets);
}
