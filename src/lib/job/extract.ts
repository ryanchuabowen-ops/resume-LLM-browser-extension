// Best-effort job description extraction from the currently-viewed page.
// There is no scraping/discovery step anymore (dropped from the original
// design) - this only ever reads the page the user is already looking at.
//
// Pure function over a Document, so it's testable against fixture HTML in a
// real browser without needing the actual content-script/messaging harness.

export interface ExtractResult {
  title: string;
  company: string;
  description: string;
  confidence: "selector" | "fallback" | "none";
}

interface SiteSelector {
  hostIncludes: string;
  descriptionSelector: string;
  titleSelector?: string;
  companySelector?: string;
}

const SITE_SELECTORS: SiteSelector[] = [
  {
    hostIncludes: "linkedin.com",
    descriptionSelector: ".jobs-description__content, .jobs-box__html-content",
    titleSelector: ".job-details-jobs-unified-top-card__job-title, h1",
    companySelector: ".job-details-jobs-unified-top-card__company-name",
  },
  {
    hostIncludes: "indeed.com",
    descriptionSelector: "#jobDescriptionText",
    titleSelector: "h1.jobsearch-JobInfoHeader-title, h1",
    companySelector: "[data-testid='inlineHeader-companyName']",
  },
  {
    hostIncludes: "greenhouse.io",
    descriptionSelector: "#content, .job__description",
    titleSelector: "h1",
  },
  {
    hostIncludes: "lever.co",
    descriptionSelector: ".posting-page .section-wrapper, .content",
    titleSelector: ".posting-headline h2, h2",
  },
  {
    hostIncludes: "myworkdayjobs.com",
    descriptionSelector: "[data-automation-id='jobPostingDescription']",
    titleSelector: "[data-automation-id='jobPostingHeader']",
  },
];

const MIN_SELECTOR_DESCRIPTION_LENGTH = 200;
const MIN_FALLBACK_DESCRIPTION_LENGTH = 100;
const EXCLUDE_TAGS = new Set(["NAV", "HEADER", "FOOTER", "SCRIPT", "STYLE", "ASIDE", "BODY", "HTML"]);
const FALLBACK_CANDIDATE_SELECTOR = "article, main, section, div";
const HIGH_LINK_DENSITY_THRESHOLD = 0.5;
const WHOLE_PAGE_RATIO_THRESHOLD = 0.9; // skip candidates that are basically "the entire page"

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? "").trim().replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ");
}

function trySiteSelector(doc: Document, site: SiteSelector): ExtractResult | null {
  const descriptionEl = doc.querySelector(site.descriptionSelector);
  const description = text(descriptionEl);
  if (description.length < MIN_SELECTOR_DESCRIPTION_LENGTH) return null;

  return {
    title: site.titleSelector ? text(doc.querySelector(site.titleSelector)) : "",
    company: site.companySelector ? text(doc.querySelector(site.companySelector)) : "",
    description,
    confidence: "selector",
  };
}

function isHighLinkDensity(el: Element): boolean {
  const totalLength = text(el).length;
  if (totalLength === 0) return true;
  let linkLength = 0;
  for (const a of el.querySelectorAll("a")) linkLength += text(a).length;
  return linkLength / totalLength > HIGH_LINK_DENSITY_THRESHOLD;
}

function findLargestVisibleTextBlock(doc: Document): string {
  const bodyLength = text(doc.body).length || 1;
  const candidates = doc.querySelectorAll(FALLBACK_CANDIDATE_SELECTOR);

  let best = "";
  for (const el of candidates) {
    if (EXCLUDE_TAGS.has(el.tagName)) continue;
    if (closestExcluded(el)) continue;

    const htmlEl = el as HTMLElement;
    if (htmlEl.offsetParent === null && htmlEl !== doc.body) continue; // not visible

    const candidateText = text(el);
    if (candidateText.length <= best.length) continue;
    if (candidateText.length / bodyLength > WHOLE_PAGE_RATIO_THRESHOLD) continue; // basically the whole page
    if (isHighLinkDensity(el)) continue;

    best = candidateText;
  }
  return best;
}

function closestExcluded(el: Element): boolean {
  let current: Element | null = el.parentElement;
  while (current) {
    if (EXCLUDE_TAGS.has(current.tagName) && current.tagName !== "BODY" && current.tagName !== "HTML") return true;
    current = current.parentElement;
  }
  return false;
}

export function extractJobDescription(doc: Document, hostname: string): ExtractResult {
  const site = SITE_SELECTORS.find((s) => hostname.includes(s.hostIncludes));
  if (site) {
    const result = trySiteSelector(doc, site);
    if (result) return result;
  }

  const fallbackText = findLargestVisibleTextBlock(doc);
  if (fallbackText.length >= MIN_FALLBACK_DESCRIPTION_LENGTH) {
    return { title: text(doc.querySelector("h1")) || doc.title, company: "", description: fallbackText, confidence: "fallback" };
  }

  return { title: doc.title ?? "", company: "", description: "", confidence: "none" };
}
