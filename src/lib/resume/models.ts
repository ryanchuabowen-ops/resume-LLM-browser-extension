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
  // True/false only when the source format can tell us: for DOCX, whether
  // mammoth's HTML conversion shows this line's ENTIRE text wrapped in a
  // single <strong> - i.e. the original Word document actually bolded this
  // whole line (see parse_docx.ts's isFullyBold). Undefined for PDF
  // sources, where no such signal is available. docx_writer.ts uses this
  // as its primary "is this a genuine anchor line" signal, since it's the
  // real ground truth rather than a guess from text shape - see that
  // file's looksLikeAnchorLine for why text length/shape alone isn't
  // reliable enough on its own.
  isEmphasized?: boolean;
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
