// Full round trip: tailor a resume, generate a fresh .docx Blob, reparse it
// with the real mammoth-based parser, and confirm the tailored content and
// highlight formatting survived.
import assert from "node:assert/strict";
import { test } from "node:test";
import { generateTailoredDocx } from "../../src/lib/resume/docx_writer.ts";
import { parseDocx } from "../../src/lib/resume/parse_docx.ts";
import { tailorRuleBased } from "../../src/lib/resume/rewriter_rule_based.ts";

const JOB = {
  title: "Senior Backend Engineer",
  company: "TestCo",
  description: "We need a Kubernetes and AWS expert with PostgreSQL experience.",
};

function buildResume() {
  return {
    contactBlock: "Jane Doe\njane.doe@example.com",
    summary: "Backend engineer with 6 years of experience.",
    sections: [{
      name: "Experience",
      bullets: [
        { text: "Senior Software Engineer, Acme Corp (2021-Present)", section: "Experience", order: 1, isListItem: false, isEmphasized: true },
        { text: "Organized team events.", section: "Experience", order: 2, isListItem: true },
        { text: "Led migration to Kubernetes and AWS with PostgreSQL.", section: "Experience", order: 3, isListItem: true },
      ],
    }],
    sourceFormat: "docx",
    sourceFileName: "resume.docx",
  };
}

test("generateTailoredDocx produces a real, reparseable docx with highlighted top bullet", async () => {
  const resume = buildResume();
  const tailored = tailorRuleBased(resume, JOB);

  const blob = await generateTailoredDocx(resume, tailored);
  assert.ok(blob.size > 0, "generated docx should not be empty");

  const arrayBuffer = await blob.arrayBuffer();
  const reopened = await parseDocx(arrayBuffer, "tailored.docx");

  // The name/contact-subtitle header is now plain (non-heading) text at the
  // top of the document, so on reparse it lands in contactBlock (text before
  // the first section heading) - matching the source resume's own shape.
  assert.match(reopened.contactBlock, /Jane Doe/);
  assert.match(reopened.contactBlock, /jane\.doe@example\.com/);
  assert.match(reopened.summary, /experience/);

  const experience = reopened.sections.find((s) => s.name === "Experience");
  assert.ok(experience);
  const kubernetesBullet = experience.bullets.find((b) => b.text.includes("Kubernetes"));
  assert.ok(kubernetesBullet, "the relevant bullet should be present in the output");

  // Bullets render with UNIFORM styling regardless of tb.highlight - real
  // feedback was that bolding every highlighted bullet produced "a clump of
  // bolded words" rather than a clean resume, since rule-based tailoring
  // commonly highlights most bullets in a short job entry. Relevance is
  // communicated by reordering (already covered by the assertions above),
  // not by bold/color. Confirm no bullet text is wrapped in <strong> - only
  // the job-title anchor line and section headings should be bold.
  // parseDocx() strips inline formatting tags, so check mammoth's raw HTML
  // directly. mammoth's Node build reads options.buffer, not
  // options.arrayBuffer (see parse_docx.ts for the same distinction).
  const mammoth = (await import("mammoth")).default;
  const html = (await mammoth.convertToHtml({ arrayBuffer, buffer: Buffer.from(arrayBuffer) })).value;
  const highlighted = tailored.bullets.find((tb) => tb.highlight);
  assert.ok(highlighted, "expected at least one highlighted bullet from tailoring, to prove this isn't a vacuous check");
  assert.doesNotMatch(
    html,
    new RegExp(`<strong>[^<]*${highlighted.newText.slice(0, 15)}`),
    "a highlighted bullet's own text must not be bolded in the output",
  );
  // The job-title anchor line SHOULD still be bold (real hierarchy, not noise).
  assert.match(html, /<strong>[^<]*Senior Software Engineer/);
});

test("generateTailoredDocx does not bold a long non-list paragraph, only short anchor-like lines", async () => {
  // Real user-reported bug: a resume's "Interests" section was written as
  // ONE long paragraph ("Interests: 1. Tinkering and coding... 2. Tableau
  // Data Analysis... 3. Kaggle competitions...") rather than real Word list
  // items. Since it's not a list item, it got isListItem:false - the same
  // flag genuine short "Job Title, Company" anchor lines use - and the
  // old code bolded/colored EVERY isListItem:false line unconditionally,
  // turning that whole long paragraph into a wall of bold text.
  const longInterestsLine =
    "Interests: 1. Tinkering and coding since 12 years old: coding websites, " +
    "viruses, worms, OSINT, 3D printing, computer vision, game development. " +
    "2. Tableau data analysis using open source datasets. " +
    "3. Kaggle competitions and codes.";
  const resume = {
    contactBlock: "Jane Doe",
    summary: "",
    sections: [{
      name: "Interests",
      bullets: [{ text: longInterestsLine, section: "Interests", order: 1, isListItem: false }],
    }],
    sourceFormat: "docx",
    sourceFileName: "resume.docx",
  };
  const tailored = {
    backendName: "rule_based",
    bullets: [{ original: resume.sections[0].bullets[0], newText: longInterestsLine, changed: false, highlight: false, newOrder: 1 }],
    summary: "",
    summaryChanged: false,
    matchedKeywords: [],
    warnings: [],
  };

  const blob = await generateTailoredDocx(resume, tailored);
  const arrayBuffer = await blob.arrayBuffer();
  const mammoth = (await import("mammoth")).default;
  const html = (await mammoth.convertToHtml({ arrayBuffer, buffer: Buffer.from(arrayBuffer) })).value;
  assert.doesNotMatch(html, /<strong>[^<]*Interests:/, "a long non-list paragraph must not be bolded wholesale like a short anchor line");

  // A genuinely short anchor line (job title/company) that the ORIGINAL
  // document actually bolded (isEmphasized:true) must still get its bold
  // anchor treatment.
  const shortAnchorResume = {
    ...resume,
    sections: [{
      name: "Experience",
      bullets: [{ text: "Senior Engineer, Acme Corp", section: "Experience", order: 1, isListItem: false, isEmphasized: true }],
    }],
  };
  const shortTailored = {
    ...tailored,
    bullets: [{ original: shortAnchorResume.sections[0].bullets[0], newText: "Senior Engineer, Acme Corp", changed: false, highlight: false, newOrder: 1 }],
  };
  const shortBlob = await generateTailoredDocx(shortAnchorResume, shortTailored);
  const shortArrayBuffer = await shortBlob.arrayBuffer();
  const shortHtml = (await mammoth.convertToHtml({ arrayBuffer: shortArrayBuffer, buffer: Buffer.from(shortArrayBuffer) })).value;
  assert.match(shortHtml, /<strong>[^<]*Senior Engineer, Acme Corp/, "a genuine short anchor line must still be bolded");
});

test("generateTailoredDocx bolds a long anchor line when the original document actually bolded it (isEmphasized:true), regardless of length", async () => {
  // These two exact lines are from a real user report: a length-only
  // anchor heuristic (an earlier, since-removed version of this logic)
  // correctly stopped bolding long prose, but ALSO stopped bolding these
  // legitimate project-title anchor lines once a full date range pushed
  // them past its length cutoff. Length was never the right signal - the
  // real signal (isEmphasized, set from whether mammoth shows the whole
  // paragraph wrapped in <strong>) doesn't care about length at all.
  const longAnchorWithDates =
    "When Risk Doesn't Add up: Modelling the Paradox of Diabetes Outcomes in Americans  15 December 2025 - 2 April 2026";
  const longAnchorWithDates2 =
    "Challenges in the deployment and Integration of Big Data Analytics across Enterprise Systems      15 December 2025 - 1 March 2026";
  assert.ok(longAnchorWithDates.length > 100 && longAnchorWithDates2.length > 100, "fixture assumption: both lines are long");

  const resume = {
    contactBlock: "Jane Doe",
    summary: "",
    sections: [{
      name: "Projects",
      bullets: [
        { text: longAnchorWithDates, section: "Projects", order: 1, isListItem: false, isEmphasized: true },
        { text: longAnchorWithDates2, section: "Projects", order: 2, isListItem: false, isEmphasized: true },
      ],
    }],
    sourceFormat: "docx",
    sourceFileName: "resume.docx",
  };
  const tailored = {
    backendName: "rule_based",
    bullets: [
      { original: resume.sections[0].bullets[0], newText: longAnchorWithDates, changed: false, highlight: false, newOrder: 1 },
      { original: resume.sections[0].bullets[1], newText: longAnchorWithDates2, changed: false, highlight: false, newOrder: 2 },
    ],
    summary: "",
    summaryChanged: false,
    matchedKeywords: [],
    warnings: [],
  };

  const blob = await generateTailoredDocx(resume, tailored);
  const arrayBuffer = await blob.arrayBuffer();
  const mammoth = (await import("mammoth")).default;
  const html = (await mammoth.convertToHtml({ arrayBuffer, buffer: Buffer.from(arrayBuffer) })).value;
  assert.match(html, /<strong>[^<]*When Risk Doesn't Add up/, "a long anchor line ending in a date range must still be bolded when isEmphasized:true");
  assert.match(html, /<strong>[^<]*Challenges in the deployment/, "a second long date-ranged anchor line must also still be bolded");
});

test("generateTailoredDocx never bolds a PDF-sourced line (isEmphasized undefined), even a short one - no length-based guessing", async () => {
  // Real, user-reported regression: a PDF's "Technical Skills" section had
  // no bullet glyphs and no hanging indent, so line-wrap reconstruction
  // occasionally left a stray mid-sentence fragment un-merged - e.g.
  // "predictive and diagnostic analysis", a fragment of a much longer
  // sentence, but only 35 characters long. A length-based fallback bolded
  // it as if it were a title, because nothing about being short actually
  // makes something a title. PDF sources have no isEmphasized signal at
  // all (parse_pdf.ts never sets it), so nothing should ever be bolded via
  // guesswork - render plain uniformly instead.
  const strayFragment = "predictive and diagnostic analysis";
  assert.ok(strayFragment.length <= 100, "fixture assumption: short enough that a length-only heuristic would have wrongly bolded it");

  const resume = {
    contactBlock: "Jane Doe",
    summary: "",
    sections: [{
      name: "Technical Skills",
      bullets: [{ text: strayFragment, section: "Technical Skills", order: 1, isListItem: false }], // isEmphasized deliberately omitted - PDF source
    }],
    sourceFormat: "pdf",
    sourceFileName: "resume.pdf",
  };
  const tailored = {
    backendName: "rule_based",
    bullets: [{ original: resume.sections[0].bullets[0], newText: strayFragment, changed: false, highlight: false, newOrder: 1 }],
    summary: "",
    summaryChanged: false,
    matchedKeywords: [],
    warnings: [],
  };

  const blob = await generateTailoredDocx(resume, tailored);
  const arrayBuffer = await blob.arrayBuffer();
  const mammoth = (await import("mammoth")).default;
  const html = (await mammoth.convertToHtml({ arrayBuffer, buffer: Buffer.from(arrayBuffer) })).value;
  assert.doesNotMatch(html, /<strong>[^<]*predictive and diagnostic/, "a short PDF-sourced fragment with no isEmphasized signal must never be bolded by guessing");
});

test("generateTailoredDocx uses Bullet.isEmphasized (real original-document formatting), not text length, when present", async () => {
  // Real regression: an "Interests" section had 3 numbered items as
  // separate non-list paragraphs, all plain (not bold) in the ORIGINAL
  // document. Items 1 (long) was correctly left plain by the old
  // length-based heuristic, but items 2 and 3 were short enough to be
  // wrongly bolded/colored as if they were job-title anchors, even though
  // the original document never bolded them. isEmphasized:false (as
  // parse_docx.ts would set for a genuinely plain original line) must
  // override the length heuristic and keep them plain regardless of how
  // short they are.
  const shortButPlainItem = "3.Kaggle competitions and codes (1 bronze): https://www.kaggle.com/code/interestednoob/";
  assert.ok(shortButPlainItem.length <= 100, "fixture assumption: short enough that the old length-only heuristic would wrongly bold it");

  const resume = {
    contactBlock: "Jane Doe",
    summary: "",
    sections: [{
      name: "Interests",
      bullets: [{ text: shortButPlainItem, section: "Interests", order: 1, isListItem: false, isEmphasized: false }],
    }],
    sourceFormat: "docx",
    sourceFileName: "resume.docx",
  };
  const tailored = {
    backendName: "rule_based",
    bullets: [{ original: resume.sections[0].bullets[0], newText: shortButPlainItem, changed: false, highlight: false, newOrder: 1 }],
    summary: "",
    summaryChanged: false,
    matchedKeywords: [],
    warnings: [],
  };

  const blob = await generateTailoredDocx(resume, tailored);
  const arrayBuffer = await blob.arrayBuffer();
  const mammoth = (await import("mammoth")).default;
  const html = (await mammoth.convertToHtml({ arrayBuffer, buffer: Buffer.from(arrayBuffer) })).value;
  assert.doesNotMatch(html, /<strong>[^<]*Kaggle/, "isEmphasized:false must keep this line plain even though it's short enough to look like an anchor by length alone");

  // And the inverse: isEmphasized:true must still bold a line even if it's
  // long enough that the length-only fallback would have left it plain.
  const longButEmphasized = "A very long project title indeed, much longer than one hundred characters in total length, still bold in the original";
  assert.ok(longButEmphasized.length > 100);
  const resume2 = { ...resume, sections: [{ name: "Projects", bullets: [{ text: longButEmphasized, section: "Projects", order: 1, isListItem: false, isEmphasized: true }] }] };
  const tailored2 = { ...tailored, bullets: [{ original: resume2.sections[0].bullets[0], newText: longButEmphasized, changed: false, highlight: false, newOrder: 1 }] };
  const blob2 = await generateTailoredDocx(resume2, tailored2);
  const arrayBuffer2 = await blob2.arrayBuffer();
  const html2 = (await mammoth.convertToHtml({ arrayBuffer: arrayBuffer2, buffer: Buffer.from(arrayBuffer2) })).value;
  assert.match(html2, /<strong>[^<]*A very long project title/, "isEmphasized:true must bold this line even though it's long enough that length alone would have left it plain");
});

test("tailoredDocxFileName produces a safe, unique-ish filename", async () => {
  const { tailoredDocxFileName } = await import("../../src/lib/resume/docx_writer.ts");
  const name = tailoredDocxFileName("Acme Corp / Inc.", "Senior Engineer!");
  assert.match(name, /^Acme_Corp_Inc_Senior_Engineer.*\.docx$/);
});
