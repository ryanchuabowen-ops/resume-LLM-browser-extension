// Base64 <-> ArrayBuffer helpers for persisting raw file bytes through
// chrome.storage.local (which is JSON-based, with no native binary type).
// Chunked deliberately: String.fromCharCode(...bytes) spread-applies every
// byte as a separate call argument, and a realistic 200KB .docx blows past
// V8's argument-count ceiling with "Maximum call stack size exceeded" if
// done unchunked - a real bug, not a theoretical one.
const CHUNK_SIZE = 8192;

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
