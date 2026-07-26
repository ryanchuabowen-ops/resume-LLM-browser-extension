import type { AutofillResult, ContentRequest, ExtractJobDescriptionResult } from "../lib/messaging/contract.ts";
import { extractJobDescription } from "../lib/job/extract.ts";
import { extractFromCurrentPage } from "./extract_job_description.ts";
import { fillApplication } from "./filler_dom.ts";
import { findFileInput, uploadGeneratedFile } from "./file_upload.ts";

console.log("[job-tailor] content script injected");

chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
  if (message.type === "EXTRACT_JOB_DESCRIPTION") {
    const result: ExtractJobDescriptionResult = extractFromCurrentPage();
    sendResponse(result);
    return false; // synchronous response
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

    const result: AutofillResult = { ...report, resumeUploaded };
    sendResponse(result);
    return false;
  }

  return false;
});

// Dev/test hook for the browser automation tool, which can't drive the real
// chrome.scripting/message-passing harness - lets it call the same DOM logic
// a real injected content script would run, directly.
(window as unknown as { jobTailorContentTest: unknown }).jobTailorContentTest = {
  extractFromCurrentPage,
  extractJobDescription: (hostname: string) => extractJobDescription(document, hostname),
  fillApplication,
  findFileInput,
  uploadGeneratedFile,
};
