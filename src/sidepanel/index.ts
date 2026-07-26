import { renderAutofillScreen } from "./screens/autofill.ts";
import { renderJobDescriptionScreen } from "./screens/job_description.ts";
import { renderSettingsScreen } from "./screens/settings.ts";
import { renderTailorReviewScreen } from "./screens/tailor_review.ts";
import { renderUploadResumeScreen } from "./screens/upload_resume.ts";
import { loadPersistedState, state } from "./state.ts";

interface Tab {
  id: string;
  label: string;
  render: (onChange: () => void) => HTMLElement;
}

const TABS: Tab[] = [
  { id: "resume", label: "Resume", render: renderUploadResumeScreen },
  { id: "job", label: "Job", render: renderJobDescriptionScreen },
  { id: "tailor", label: "Tailor", render: renderTailorReviewScreen },
  { id: "apply", label: "Apply", render: renderAutofillScreen },
  { id: "settings", label: "Settings", render: renderSettingsScreen },
];

let activeTabId = TABS[0]!.id;

function renderApp(): void {
  const app = document.getElementById("app");
  if (!app) return;
  app.innerHTML = "";

  const disclaimer = document.createElement("div");
  disclaimer.className = "disclaimer-bar";
  disclaimer.textContent =
    "This extension never submits an application for you. It fills forms and stops - you always review and click Submit yourself.";
  app.appendChild(disclaimer);

  const nav = document.createElement("nav");
  nav.className = "tabs";
  for (const tab of TABS) {
    const btn = document.createElement("button");
    btn.textContent = tab.label;
    btn.className = tab.id === activeTabId ? "tab-btn active" : "tab-btn";
    btn.addEventListener("click", () => {
      activeTabId = tab.id;
      renderApp();
    });
    nav.appendChild(btn);
  }
  app.appendChild(nav);

  const main = document.createElement("main");
  const activeTab = TABS.find((t) => t.id === activeTabId)!;
  main.appendChild(activeTab.render(renderApp));
  app.appendChild(main);
}

console.log("[job-tailor] side panel started");
loadPersistedState().then(renderApp);

// Dev/test hook for the browser automation tool, which can't drive the real
// chrome.sidePanel harness - lets it inspect/drive state and re-render
// directly.
(window as unknown as { jobTailorTest: unknown }).jobTailorTest = { state, renderApp, setActiveTab: (id: string) => { activeTabId = id; renderApp(); } };
