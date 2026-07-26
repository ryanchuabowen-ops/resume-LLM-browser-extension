"use strict";
(() => {
  // src/lib/job/extract.ts
  var SITE_SELECTORS = [
    {
      hostIncludes: "linkedin.com",
      descriptionSelector: ".jobs-description__content, .jobs-box__html-content",
      titleSelector: ".job-details-jobs-unified-top-card__job-title, h1",
      companySelector: ".job-details-jobs-unified-top-card__company-name"
    },
    {
      hostIncludes: "indeed.com",
      descriptionSelector: "#jobDescriptionText",
      titleSelector: "h1.jobsearch-JobInfoHeader-title, h1",
      companySelector: "[data-testid='inlineHeader-companyName']"
    },
    {
      hostIncludes: "greenhouse.io",
      descriptionSelector: "#content, .job__description",
      titleSelector: "h1"
    },
    {
      hostIncludes: "lever.co",
      descriptionSelector: ".posting-page .section-wrapper, .content",
      titleSelector: ".posting-headline h2, h2"
    },
    {
      hostIncludes: "myworkdayjobs.com",
      descriptionSelector: "[data-automation-id='jobPostingDescription']",
      titleSelector: "[data-automation-id='jobPostingHeader']"
    }
  ];
  var MIN_SELECTOR_DESCRIPTION_LENGTH = 200;
  var MIN_FALLBACK_DESCRIPTION_LENGTH = 100;
  var EXCLUDE_TAGS = /* @__PURE__ */ new Set(["NAV", "HEADER", "FOOTER", "SCRIPT", "STYLE", "ASIDE", "BODY", "HTML"]);
  var FALLBACK_CANDIDATE_SELECTOR = "article, main, section, div";
  var HIGH_LINK_DENSITY_THRESHOLD = 0.5;
  var WHOLE_PAGE_RATIO_THRESHOLD = 0.9;
  function text(el) {
    return (el?.textContent ?? "").trim().replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ");
  }
  function trySiteSelector(doc, site) {
    const descriptionEl = doc.querySelector(site.descriptionSelector);
    const description = text(descriptionEl);
    if (description.length < MIN_SELECTOR_DESCRIPTION_LENGTH) return null;
    return {
      title: site.titleSelector ? text(doc.querySelector(site.titleSelector)) : "",
      company: site.companySelector ? text(doc.querySelector(site.companySelector)) : "",
      description,
      confidence: "selector"
    };
  }
  function isHighLinkDensity(el) {
    const totalLength = text(el).length;
    if (totalLength === 0) return true;
    let linkLength = 0;
    for (const a of el.querySelectorAll("a")) linkLength += text(a).length;
    return linkLength / totalLength > HIGH_LINK_DENSITY_THRESHOLD;
  }
  function findLargestVisibleTextBlock(doc) {
    const bodyLength = text(doc.body).length || 1;
    const candidates = doc.querySelectorAll(FALLBACK_CANDIDATE_SELECTOR);
    let best = "";
    for (const el of candidates) {
      if (EXCLUDE_TAGS.has(el.tagName)) continue;
      if (closestExcluded(el)) continue;
      const htmlEl = el;
      if (htmlEl.offsetParent === null && htmlEl !== doc.body) continue;
      const candidateText = text(el);
      if (candidateText.length <= best.length) continue;
      if (candidateText.length / bodyLength > WHOLE_PAGE_RATIO_THRESHOLD) continue;
      if (isHighLinkDensity(el)) continue;
      best = candidateText;
    }
    return best;
  }
  function closestExcluded(el) {
    let current = el.parentElement;
    while (current) {
      if (EXCLUDE_TAGS.has(current.tagName) && current.tagName !== "BODY" && current.tagName !== "HTML") return true;
      current = current.parentElement;
    }
    return false;
  }
  function extractJobDescription(doc, hostname) {
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

  // src/content/extract_job_description.ts
  function extractFromCurrentPage() {
    return extractJobDescription(document, location.hostname);
  }

  // src/lib/autofill/profile_fields.ts
  function firstName(p) {
    if (p.firstName) return p.firstName;
    return p.fullName.split(/\s+/)[0] ?? "";
  }
  function lastName(p) {
    if (p.lastName) return p.lastName;
    const parts = p.fullName.split(/\s+/).filter(Boolean);
    return parts.length > 1 ? parts[parts.length - 1] : "";
  }
  var FIELD_SPECS = [
    { key: "first_name", keywords: ["first name", "given name", "fname"], getter: firstName },
    { key: "last_name", keywords: ["last name", "surname", "family name", "lname"], getter: lastName },
    { key: "full_name", keywords: ["full name", "your name", "applicant name", "name"], getter: (p) => p.fullName },
    { key: "email", keywords: ["email", "e-mail"], getter: (p) => p.email },
    { key: "phone", keywords: ["phone", "mobile", "telephone"], getter: (p) => p.phone },
    {
      key: "location",
      keywords: ["location", "city", "mailing address", "home address", "street address", "current address"],
      getter: (p) => p.location
    },
    { key: "linkedin_url", keywords: ["linkedin"], getter: (p) => p.linkedinUrl },
    { key: "portfolio_url", keywords: ["portfolio", "personal website", "website"], getter: (p) => p.portfolioUrl },
    { key: "github_url", keywords: ["github"], getter: (p) => p.githubUrl },
    {
      key: "work_authorization",
      keywords: ["work authorization", "authorized to work", "legally authorized"],
      getter: (p) => p.workAuthorization
    },
    { key: "requires_sponsorship", keywords: ["sponsorship", "visa sponsorship"], getter: (p) => p.requiresSponsorship }
  ];
  var BY_KEY = new Map(FIELD_SPECS.map((spec) => [spec.key, spec]));
  function getFieldValue(profile, key) {
    const spec = BY_KEY.get(key);
    if (!spec) return "";
    try {
      return spec.getter(profile) || "";
    } catch {
      return "";
    }
  }

  // src/lib/autofill/field_mapper.ts
  var MIN_CONFIDENCE = 4;
  function matchField(labelText) {
    const lowered = labelText.toLowerCase();
    let bestKey = null;
    let bestLen = 0;
    for (const spec of FIELD_SPECS) {
      for (const kw of spec.keywords) {
        if (kw.length > bestLen && lowered.includes(kw)) {
          bestLen = kw.length;
          bestKey = spec.key;
        }
      }
    }
    if (bestLen < MIN_CONFIDENCE) return { key: null, confidence: bestLen };
    return { key: bestKey, confidence: bestLen };
  }

  // src/content/filler_dom.ts
  var TEXT_LIKE_TYPES = /* @__PURE__ */ new Set(["", "text", "email", "tel", "url", "search"]);
  function gatherLabelText(el) {
    const parts = [];
    const id = el.getAttribute("id");
    if (id) {
      const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (label?.textContent) parts.push(label.textContent);
    }
    for (const attr of ["aria-label", "placeholder", "name"]) {
      const val = el.getAttribute(attr);
      if (val) parts.push(val);
    }
    return parts.filter(Boolean).join(" ").trim();
  }
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function setSelectValue(el, value) {
    const lowered = value.toLowerCase();
    for (const option of Array.from(el.options)) {
      if (option.textContent?.trim().toLowerCase() === lowered || option.value.toLowerCase() === lowered) {
        el.value = option.value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }
    return false;
  }
  function fillApplication(profile) {
    const report = { filled: [], unmappedLabels: [], errors: [] };
    const elements = document.querySelectorAll("input, textarea, select");
    for (const el of elements) {
      const tag = el.tagName.toLowerCase();
      if (tag === "input") {
        const type = el.type.toLowerCase();
        if (!TEXT_LIKE_TYPES.has(type)) continue;
      }
      const labelText = gatherLabelText(el);
      const { key } = matchField(labelText);
      if (!key) {
        if (labelText) report.unmappedLabels.push(labelText);
        continue;
      }
      const value = getFieldValue(profile, key);
      if (!value) continue;
      try {
        if (tag === "select") {
          if (setSelectValue(el, value)) {
            report.filled.push(`${key}: ${labelText || tag}`);
          }
        } else {
          setNativeValue(el, value);
          report.filled.push(`${key}: ${labelText || tag}`);
        }
      } catch (err) {
        report.errors.push(`Failed to fill ${key} (${labelText}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return report;
  }

  // src/content/file_upload.ts
  function findFileInput() {
    return document.querySelector("input[type='file']");
  }
  function uploadGeneratedFile(input, buffer, fileName, mimeType) {
    const file = new File([buffer], fileName, { type: mimeType });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    input.files = dataTransfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // src/content/index.ts
  console.log("[job-tailor] content script injected");
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "EXTRACT_JOB_DESCRIPTION") {
      const result = extractFromCurrentPage();
      sendResponse(result);
      return false;
    }
    if (message.type === "AUTOFILL_FORM") {
      const report = fillApplication(message.profile);
      let resumeUploaded = false;
      if (message.resumeFile) {
        const fileInput = findFileInput();
        if (fileInput) {
          try {
            uploadGeneratedFile(fileInput, message.resumeFile.buffer, message.resumeFile.fileName, message.resumeFile.mimeType);
            resumeUploaded = true;
          } catch (err) {
            report.errors.push(`Failed to upload resume: ${err instanceof Error ? err.message : String(err)}`);
          }
        } else {
          report.errors.push("No file upload field found on this page");
        }
      }
      const result = { ...report, resumeUploaded };
      sendResponse(result);
      return false;
    }
    return false;
  });
  window.jobTailorContentTest = {
    extractFromCurrentPage,
    extractJobDescription: (hostname) => extractJobDescription(document, hostname),
    fillApplication,
    findFileInput,
    uploadGeneratedFile
  };
})();
//# sourceMappingURL=content.js.map
