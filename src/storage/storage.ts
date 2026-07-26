// Thin wrapper around chrome.storage.local - only usable inside an extension
// context (background/content/sidepanel), not under plain Node.
import { DEFAULT_PROFILE, DEFAULT_SETTINGS } from "./schema.ts";
import type { AppSettings, StorageSchema, StoredResume, UserProfile } from "./schema.ts";

async function get<K extends keyof StorageSchema>(key: K): Promise<StorageSchema[K]> {
  const result = await chrome.storage.local.get(key);
  return result[key];
}

async function set<K extends keyof StorageSchema>(key: K, value: StorageSchema[K]): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function getResume(): Promise<StoredResume | undefined> {
  return get("resume");
}

export async function setResume(resume: StoredResume): Promise<void> {
  await set("resume", resume);
}

export async function getProfile(): Promise<UserProfile> {
  return (await get("profile")) ?? DEFAULT_PROFILE;
}

export async function setProfile(profile: UserProfile): Promise<void> {
  await set("profile", profile);
}

export async function getSettings(): Promise<AppSettings> {
  return (await get("settings")) ?? DEFAULT_SETTINGS;
}

export async function setSettings(settings: AppSettings): Promise<void> {
  await set("settings", settings);
}

export async function clearAll(): Promise<void> {
  await chrome.storage.local.clear();
}
