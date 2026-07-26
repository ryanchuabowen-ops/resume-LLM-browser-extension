// Canonical application-form field schema. Port of
// job-agent/autofill/profile_fields.py, carrying forward a real fix found
// via live testing: keywords must be reasoned about for substring
// collisions against EVERY other spec's keywords, not just assumed safe.
//
// The "address" collision: a bare "address" keyword is a substring of
// "Email Address," and being longer than "email" (8 chars vs 5), it would
// win the longest-match scoring in field_mapper.ts and hijack email fields
// into the location field. Fixed by requiring a qualifier
// ("mailing/home/street/current address") instead of the bare word.
//
// Re-checked the rest of the list fresh for the same collision class:
// "name" (bare, under full_name) is a substring of "first name"/"last
// name"/"full name," but those are all *longer* than bare "name," so the
// longest-match rule already prefers them correctly - bare "name" only wins
// for genuinely generic "Name" labels. No other cross-spec substring
// collisions found. If you add a new keyword, re-check this reasoning.
import type { UserProfile } from "../../storage/schema.ts";

function firstName(p: UserProfile): string {
  if (p.firstName) return p.firstName;
  return p.fullName.split(/\s+/)[0] ?? "";
}

function lastName(p: UserProfile): string {
  if (p.lastName) return p.lastName;
  const parts = p.fullName.split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1]! : "";
}

export interface FieldSpec {
  key: string;
  keywords: string[];
  getter: (p: UserProfile) => string;
}

export const FIELD_SPECS: FieldSpec[] = [
  { key: "first_name", keywords: ["first name", "given name", "fname"], getter: firstName },
  { key: "last_name", keywords: ["last name", "surname", "family name", "lname"], getter: lastName },
  { key: "full_name", keywords: ["full name", "your name", "applicant name", "name"], getter: (p) => p.fullName },
  { key: "email", keywords: ["email", "e-mail"], getter: (p) => p.email },
  { key: "phone", keywords: ["phone", "mobile", "telephone"], getter: (p) => p.phone },
  {
    key: "location",
    keywords: ["location", "city", "mailing address", "home address", "street address", "current address"],
    getter: (p) => p.location,
  },
  { key: "linkedin_url", keywords: ["linkedin"], getter: (p) => p.linkedinUrl },
  { key: "portfolio_url", keywords: ["portfolio", "personal website", "website"], getter: (p) => p.portfolioUrl },
  { key: "github_url", keywords: ["github"], getter: (p) => p.githubUrl },
  {
    key: "work_authorization",
    keywords: ["work authorization", "authorized to work", "legally authorized"],
    getter: (p) => p.workAuthorization,
  },
  { key: "requires_sponsorship", keywords: ["sponsorship", "visa sponsorship"], getter: (p) => p.requiresSponsorship },
];

const BY_KEY = new Map(FIELD_SPECS.map((spec) => [spec.key, spec]));

export function getFieldValue(profile: UserProfile, key: string): string {
  const spec = BY_KEY.get(key);
  if (!spec) return "";
  try {
    return spec.getter(profile) || "";
  } catch {
    return "";
  }
}
