// Uploads the tailored resume to a file input, via an in-memory-constructed
// File assigned through a DataTransfer. This is the content-script
// replacement for Playwright's set_input_files() - a content script has no
// direct way to hand a native OS file to an <input type="file">.
//
// Best-effort, not guaranteed: some sites check event.isTrusted on the file
// input's change handler, or run bot-detection that rejects programmatic
// file assignment - same "best-effort, may not work everywhere" posture the
// Python version's Playwright autofill already used for the whole page.

export function findFileInput(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>("input[type='file']");
}

export function uploadGeneratedFile(
  input: HTMLInputElement,
  buffer: ArrayBuffer,
  fileName: string,
  mimeType: string,
): void {
  const file = new File([buffer], fileName, { type: mimeType });
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  input.files = dataTransfer.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
