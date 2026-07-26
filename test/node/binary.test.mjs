import assert from "node:assert/strict";
import { test } from "node:test";
import { arrayBufferToBase64, base64ToArrayBuffer } from "../../src/storage/binary.ts";

test("round-trips a small buffer exactly", () => {
  const original = new Uint8Array([0, 1, 2, 255, 254, 128, 65]).buffer;
  const roundTripped = base64ToArrayBuffer(arrayBufferToBase64(original));
  assert.deepEqual(new Uint8Array(roundTripped), new Uint8Array(original));
});

test("round-trips a >500,000-byte random buffer without a call-stack overflow", () => {
  // The naive String.fromCharCode(...bytes) (unchunked spread) blows V8's
  // argument-count ceiling well before this size - this is the regression
  // test proving the chunked encoder actually avoids that failure.
  const size = 512 * 1024 + 137; // deliberately not a round chunk multiple
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 37 + 11) % 256;

  const base64 = arrayBufferToBase64(bytes.buffer);
  const roundTripped = new Uint8Array(base64ToArrayBuffer(base64));
  assert.deepEqual(roundTripped, bytes);
});

test("round-trips an empty buffer", () => {
  const roundTripped = base64ToArrayBuffer(arrayBufferToBase64(new ArrayBuffer(0)));
  assert.equal(roundTripped.byteLength, 0);
});
