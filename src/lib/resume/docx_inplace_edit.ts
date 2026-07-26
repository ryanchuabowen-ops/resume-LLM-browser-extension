// Pure DOM mutations against matched <w:p> elements. Throws on any trouble
// - no fallback logic lives here, that's docx_inplace.ts's job as the sole
// "convert doubt into a safe null" boundary.
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

function directRunChildren(paragraphEl: Element): Element[] {
  const runs: Element[] = [];
  for (let i = 0; i < paragraphEl.childNodes.length; i++) {
    const node = paragraphEl.childNodes[i]!;
    if (node.nodeType !== 1 /* ELEMENT_NODE */) continue;
    const el = node as Element;
    if (el.localName === "r" && el.namespaceURI === W_NS) runs.push(el);
  }
  return runs;
}

// Replaces a paragraph's visible text by writing into the first run's
// <w:t> text node directly (never recreating the <w:t>/<w:r> elements), so
// that run's sibling <w:rPr> (font, bold, color, size) survives untouched.
// Every other run in the paragraph is removed outright - the same
// "collapse into first run" simplification used by the old Python version.
export function replaceParagraphText(paragraphEl: Element, newText: string): void {
  const runs = directRunChildren(paragraphEl);
  if (runs.length === 0) {
    throw new Error("Paragraph has no <w:r> runs to replace text in");
  }
  const doc = paragraphEl.ownerDocument;
  if (!doc) throw new Error("Paragraph element has no owner document");

  const firstRun = runs[0]!;
  const existingTs = firstRun.getElementsByTagNameNS(W_NS, "t");
  let tEl: Element;
  if (existingTs.length > 0) {
    tEl = existingTs[0]!;
    for (let i = existingTs.length - 1; i >= 1; i--) {
      existingTs[i]!.parentNode?.removeChild(existingTs[i]!);
    }
  } else {
    tEl = doc.createElementNS(W_NS, "w:t");
    firstRun.appendChild(tEl);
  }

  while (tEl.firstChild) tEl.removeChild(tEl.firstChild);
  tEl.appendChild(doc.createTextNode(newText));

  // Word requires xml:space="preserve" on <w:t> for runs with significant
  // leading/trailing whitespace, or it may be collapsed on next open/save.
  if (newText !== newText.trim()) {
    tEl.setAttributeNS(XML_NS, "xml:space", "preserve");
  }

  for (let i = runs.length - 1; i >= 1; i--) {
    runs[i]!.parentNode?.removeChild(runs[i]!);
  }
}

// Physically relocates a section's paragraph elements to match the already
// anchor-boundary-safe order computed upstream (TailoredBullet.newOrder via
// segmentListRuns) - this function trusts that order, it never re-derives
// it. `orderedElements` must already be sorted into the desired final
// sequence. Every element must share the same DOM parent (guards against
// table-based layouts, where "reordering" across cells would be
// meaningless) - callers should treat a thrown error here as a signal to
// abort the whole in-place attempt, not just skip this section.
export function reorderSectionParagraphs(orderedElements: Element[]): void {
  if (orderedElements.length <= 1) return;

  const parent = orderedElements[0]!.parentNode;
  if (!parent) throw new Error("Paragraph has no parent element - cannot reorder");
  for (const el of orderedElements) {
    if (el.parentNode !== parent) {
      throw new Error("Paragraphs to reorder must all share the same parent element");
    }
  }

  // insertBefore on a node that is already a child implicitly removes it
  // first, so chaining "place current right after prev" for every
  // subsequent element reproduces the desired sequence regardless of each
  // element's original position, while leaving orderedElements[0] itself -
  // and anything NOT in this list - undisturbed as anchors.
  for (let i = 1; i < orderedElements.length; i++) {
    const prev = orderedElements[i - 1]!;
    const current = orderedElements[i]!;
    const target = prev.nextSibling;
    // Skip when `current` is already exactly where it needs to be -
    // insertBefore(current, current) is a spec no-op, but at least one DOM
    // implementation (xmldom, used for Node test coverage) corrupts its
    // internal child-index bookkeeping on that exact call, so it's avoided
    // outright rather than relied upon to be handled gracefully.
    if (current === target) continue;
    parent.insertBefore(current, target);
  }
}
