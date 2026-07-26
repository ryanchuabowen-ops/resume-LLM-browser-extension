// Ports the real "Email Address" vs bare "address" collision bug found via
// live testing in the Python version.
import assert from "node:assert/strict";
import { test } from "node:test";
import { matchField } from "../../src/lib/autofill/field_mapper.ts";

test("does not hijack 'Email Address' into location (the real address/email collision)", () => {
  const result = matchField("Email Address");
  assert.equal(result.key, "email", `expected 'email', got ${result.key}`);
});

test("matches 'First Name' over the generic 'name' keyword", () => {
  assert.equal(matchField("First Name").key, "first_name");
  assert.equal(matchField("Last Name").key, "last_name");
});

test("bare 'Name' label falls back to full_name", () => {
  assert.equal(matchField("Name").key, "full_name");
});

test("matches phone, linkedin, github, portfolio fields", () => {
  assert.equal(matchField("Phone Number").key, "phone");
  assert.equal(matchField("LinkedIn Profile URL").key, "linkedin_url");
  assert.equal(matchField("GitHub").key, "github_url");
  assert.equal(matchField("Portfolio / Personal Website").key, "portfolio_url");
});

test("matches mailing/home/street address to location, but not bare 'address'", () => {
  assert.equal(matchField("Mailing Address").key, "location");
  assert.equal(matchField("Home Address").key, "location");
  assert.equal(matchField("Street Address").key, "location");
});

test("unrelated label stays unmapped below the confidence threshold", () => {
  const result = matchField("Cover Letter");
  assert.equal(result.key, null);
});

test("work authorization and sponsorship fields map correctly and don't collide", () => {
  assert.equal(matchField("Are you authorized to work in this country?").key, "work_authorization");
  assert.equal(matchField("Do you require visa sponsorship?").key, "requires_sponsorship");
});
