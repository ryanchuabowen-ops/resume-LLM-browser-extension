// Flat, in-document-order extraction of <w:p> paragraphs from a parsed
// word/document.xml Document. Deliberately does NOT attempt heading/
// list-item classification the way mammoth (used for the safe, always-on
// ResumeDocument parse) does - replicating that classification here and
// risking it silently disagreeing with mammoth's own is exactly the
// dangerous failure mode this feature avoids. Correlation to bullets
// happens purely by text content in docx_match.ts instead.
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export interface XmlParagraph {
  element: Element;
  text: string;
  // True only if every non-w:pPr child is a plain <w:r> run - false for
  // paragraphs containing a hyperlink, field, content control, or tracked
  // change, which text-replacement must not attempt to touch.
  isSimpleEditable: boolean;
}

const ALWAYS_IGNORED_LOCAL_NAMES = new Set(["pPr", "bookmarkStart", "bookmarkEnd", "proofErr"]);

export function extractParagraphs(doc: Document): XmlParagraph[] {
  const paragraphEls = Array.from(doc.getElementsByTagNameNS(W_NS, "p"));
  return paragraphEls.map((element) => ({
    element,
    text: extractText(element),
    isSimpleEditable: isSimpleEditableParagraph(element),
  }));
}

// Walks every descendant in document order, not just <w:t> - a paragraph
// like "University of London" <w:tab/> "Singapore" (a common right-aligned
// "left text ... tab ... right text" layout) has its tab as a SEPARATE
// sibling element, not text inside any <w:t>. Reading only <w:t> silently
// drops it, producing "University of LondonSingapore" - which then fails
// to match this same line's mammoth-derived Bullet.text (mammoth already
// converts <w:tab/> to a literal "\t", confirmed by direct testing), so
// the whole in-place attempt would wrongly abort for any resume using this
// layout pattern. <w:tab/> -> "\t" and <w:br/>/<w:cr/> -> "\n" here to
// match mammoth's own behavior exactly.
function extractText(paragraphEl: Element): string {
  let text = "";
  const walk = (node: Node): void => {
    if (node.nodeType !== 1 /* ELEMENT_NODE */) return;
    const el = node as Element;
    if (el.namespaceURI === W_NS && el.localName === "t") {
      text += el.textContent ?? "";
      return;
    }
    if (el.namespaceURI === W_NS && el.localName === "tab") {
      text += "\t";
      return;
    }
    if (el.namespaceURI === W_NS && (el.localName === "br" || el.localName === "cr")) {
      text += "\n";
      return;
    }
    for (let i = 0; i < el.childNodes.length; i++) walk(el.childNodes[i]!);
  };
  walk(paragraphEl);
  return text;
}

function isSimpleEditableParagraph(paragraphEl: Element): boolean {
  for (let i = 0; i < paragraphEl.childNodes.length; i++) {
    const child = paragraphEl.childNodes[i]!;
    if (child.nodeType !== 1 /* ELEMENT_NODE */) continue;
    const el = child as Element;
    if (el.localName === "r" && el.namespaceURI === W_NS) continue;
    if (ALWAYS_IGNORED_LOCAL_NAMES.has(el.localName ?? "") && el.namespaceURI === W_NS) continue;
    return false;
  }
  return true;
}
