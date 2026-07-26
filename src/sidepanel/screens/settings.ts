import type { UserProfile } from "../../storage/schema.ts";
import { persistProfile, persistSettings, state } from "../state.ts";

const PROFILE_FIELDS: { id: string; key: keyof UserProfile; label: string; placeholder?: string }[] = [
  { id: "p-full-name", key: "fullName", label: "Full name" },
  { id: "p-first-name", key: "firstName", label: "First name" },
  { id: "p-last-name", key: "lastName", label: "Last name" },
  { id: "p-email", key: "email", label: "Email" },
  { id: "p-phone", key: "phone", label: "Phone" },
  { id: "p-location", key: "location", label: "Location" },
  { id: "p-linkedin", key: "linkedinUrl", label: "LinkedIn URL" },
  { id: "p-portfolio", key: "portfolioUrl", label: "Portfolio URL" },
  { id: "p-github", key: "githubUrl", label: "GitHub URL" },
  { id: "p-work-auth", key: "workAuthorization", label: "Work authorization", placeholder: "e.g. U.S. Citizen" },
  { id: "p-sponsorship", key: "requiresSponsorship", label: "Requires sponsorship", placeholder: "e.g. No" },
];

export function renderSettingsScreen(_onChange: () => void): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = `
    <h2>Profile</h2>
    <p class="muted">Used to fill in application forms. Stored only on this device.</p>
    <div class="form-grid">
      ${PROFILE_FIELDS.map((f) => `<label>${f.label} <input id="${f.id}" type="text" placeholder="${f.placeholder ?? ""}"></label>`).join("")}
    </div>
    <button id="save-profile-btn">Save profile</button>
    <span id="profile-status" class="muted"></span>

    <h2>Settings</h2>
    <div class="form-grid">
      <label>Ollama base URL <input id="s-ollama-url" type="text"></label>
    </div>
    <p class="muted">
      Ollama does its own origin allowlisting independent of the browser. If AI tailoring
      can't reach Ollama, set <code>OLLAMA_ORIGINS</code> to include this extension's origin
      (shown on <code>chrome://extensions</code>) and restart Ollama.
    </p>
    <button id="save-settings-btn">Save settings</button>
    <span id="settings-status" class="muted"></span>

    <h2>Data</h2>
    <button id="clear-data-btn" class="secondary">Clear all stored data</button>
  `;

  for (const f of PROFILE_FIELDS) {
    const input = container.querySelector<HTMLInputElement>(`#${f.id}`)!;
    input.value = state.profile[f.key] as string;
  }

  container.querySelector<HTMLButtonElement>("#save-profile-btn")!.addEventListener("click", async () => {
    const profile: UserProfile = { ...state.profile };
    for (const f of PROFILE_FIELDS) {
      const input = container.querySelector<HTMLInputElement>(`#${f.id}`)!;
      (profile[f.key] as string) = input.value;
    }
    await persistProfile(profile);
    container.querySelector("#profile-status")!.textContent = "Saved.";
  });

  const ollamaUrlInput = container.querySelector<HTMLInputElement>("#s-ollama-url")!;
  ollamaUrlInput.value = state.settings.ollama.baseUrl;
  container.querySelector<HTMLButtonElement>("#save-settings-btn")!.addEventListener("click", async () => {
    await persistSettings({ ...state.settings, ollama: { ...state.settings.ollama, baseUrl: ollamaUrlInput.value } });
    container.querySelector("#settings-status")!.textContent = "Saved.";
  });

  container.querySelector<HTMLButtonElement>("#clear-data-btn")!.addEventListener("click", async () => {
    if (!confirm("Clear all stored resume, profile, and settings data?")) return;
    await chrome.storage.local.clear();
    location.reload(); // simplest way to reset in-memory state back to defaults too
  });

  return container;
}
