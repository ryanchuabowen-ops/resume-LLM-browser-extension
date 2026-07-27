// Detects and merges resume section headings that were probably meant to
// be a sub-heading within the previous section rather than a genuinely
// separate top-level section. Needed because the parser
// (section_detect.ts's looksLikeSectionHeader) has no reliable signal to
// tell these apart on its own: a document that uses plain bold/all-caps
// text for BOTH a real section header and an in-section sub-heading
// (rather than Word's actual heading-level styles) looks identical either
// way. Real user-reported case: "SKILLS, ACTIVITIES & INTERESTS" followed
// immediately by just one bullet, then "TECHNICAL SKILLS" - clearly meant
// as a sub-topic of the first, not its own section.
//
// Deterministic, not LLM-based - an earlier version asked a local LLM to
// judge whether two candidate headings were topically related before
// merging (safer against merging two genuinely unrelated short sections),
// but the user explicitly chose this simpler, always-available,
// no-Ollama-dependency version instead: any sparse section immediately
// followed by another heading is unconditionally folded in as a
// sub-heading. Accepted trade-off, stated plainly: this can occasionally
// merge two genuinely separate but both-short sections (e.g. a 1-bullet
// "Awards" section right before a 1-bullet "Certifications" section) -
// there is no way to avoid that risk without either asking an LLM (ruled
// out) or real heading-level metadata the source document may not have.
import type { Bullet, ResumeDocument, Section } from "./models.ts";

// Only a section with very few bullets before the NEXT heading interrupts
// it is a plausible "this was meant to be an umbrella heading" candidate -
// a section with substantial content is left alone regardless of what
// heading follows it.
const SPARSE_BULLET_THRESHOLD = 2;

export interface MergeCandidate {
  sparseIndex: number; // index of the section suspected to be an umbrella heading
  nextIndex: number; // index of the section suspected to actually be its sub-heading
}

export function findMergeCandidates(sections: Section[]): MergeCandidate[] {
  const candidates: MergeCandidate[] = [];
  for (let i = 0; i < sections.length - 1; i++) {
    const bulletCount = sections[i]!.bullets.length;
    if (bulletCount > 0 && bulletCount <= SPARSE_BULLET_THRESHOLD) {
      candidates.push({ sparseIndex: i, nextIndex: i + 1 });
    }
  }
  return candidates;
}

// Pure and synchronous - unconditionally merges every candidate found by
// findMergeCandidates, folding the sub-heading's own name in as a bold
// anchor line so it isn't lost, just demoted from its own section.
export function mergeSparseSections(document: ResumeDocument): ResumeDocument {
  const candidates = findMergeCandidates(document.sections);
  if (candidates.length === 0) return document;

  const mergeIntoPrevious = new Set(candidates.map((c) => c.nextIndex));

  const mergedSections: Section[] = [];
  for (let i = 0; i < document.sections.length; i++) {
    const section = document.sections[i]!;
    if (mergeIntoPrevious.has(i)) {
      const previous = mergedSections[mergedSections.length - 1];
      if (!previous) {
        // Defensive only - candidates always have nextIndex >= 1, so a
        // preceding, kept section always exists by this point.
        mergedSections.push({ ...section, bullets: [...section.bullets] });
        continue;
      }
      const subHeadingBullet: Bullet = { text: section.name, section: previous.name, order: 0, isListItem: false };
      previous.bullets.push(subHeadingBullet, ...section.bullets.map((b) => ({ ...b, section: previous.name })));
      continue;
    }
    mergedSections.push({ ...section, bullets: [...section.bullets] });
  }

  return { ...document, sections: renumberOrder(mergedSections) };
}

// Bullet.order is a single monotonic counter across the whole document
// (see build_document.ts) - everything downstream (segmentListRuns,
// docx_match.ts's order-anchored matching) depends on that invariant, so
// merging sections must re-establish it in the new final order rather than
// leaving gaps or duplicates behind.
function renumberOrder(sections: Section[]): Section[] {
  let order = 0;
  return sections.map((s) => ({
    ...s,
    bullets: s.bullets.map((b) => ({ ...b, order: ++order })),
  }));
}
