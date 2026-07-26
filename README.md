# Job Resume Tailor (Chrome extension)

A local, single-user Chrome extension that tailors your resume to a job
posting and helps fill in the application form on that page. Everything
runs client-side in your browser — no backend server, no account, no data
leaves your machine except an optional local call to Ollama on
`127.0.0.1`.

**It never submits an application for you.** Autofill fills in what it can
and stops — you always review the page and click Submit yourself.

This is a rebuild of an earlier desktop-app version (`job-agent/`, a
Python/PyInstaller app) as a Chrome extension. The old app's job
board scraping (LinkedIn/Indeed/Glassdoor via Playwright) was dropped
entirely and never came back — this extension only reads the job page
you're already looking at. The one job-discovery feature it does have
(under Job → Find Jobs) never scrapes anything either: it has an LLM read
your resume and suggest a few Google Jobs searches, then opens real
Google Jobs tabs for you to browse yourself. See "Find Jobs" below for why
it's built this way.

## What it does

1. **Upload Resume** — upload a `.docx` or `.pdf`, parsed entirely in your
   browser (via `mammoth` for DOCX, `pdfjs-dist` for PDF).
2. **Job Description** — extract the description from the current tab
   (best-effort, several common ATS sites plus a generic fallback), or just
   paste it in yourself. The same tab also has **Find Jobs**: reads your
   uploaded resume (rule-based keyword extraction, or a local Ollama model)
   and suggests a handful of varied Google Jobs search queries, each with a
   button that opens a real Google Jobs tab for that query. This is
   deliberately *not* a scraper — no page content is read back into the
   extension, only a search query is constructed and a normal tab is
   opened, exactly like clicking an ordinary link. That's a deliberate
   choice: Google's Terms of Service prohibit automated querying, Google is
   aggressive about detecting and blocking exactly that kind of automation,
   and the development tooling used to build this extension refused to even
   navigate to `google.com` for that reason. Every suggested query is also
   checked for at least one word of real overlap with your resume's own
   text before being shown, and anything with zero overlap is dropped
   silently, since an LLM asked to generate several variations will
   sometimes invent a role or skill your resume never mentioned.
3. **Tailor & Review** — reorders/highlights your most relevant bullets
   (offline, no AI needed), or optionally rewords them with a local Ollama
   model. Shows a diff before you commit to anything.
4. **Apply** — download the tailored resume as a styled `.docx` (name/contact
   header, colored section headings, bold job titles, highlighted bullets —
   see the formatting note below), and/or autofill the form on the current
   page (name, email, phone, links, etc. — whatever it can confidently
   match). Stops before Submit, always.
5. **Settings** — your profile info (used for autofill) and Ollama config,
   stored only in this browser's local extension storage.

## Known limitations (read before relying on this)

- **Your original resume's exact formatting isn't preserved.** Unlike the
  original desktop app, this always *regenerates* a fresh `.docx` from your
  resume's text content, rather than editing your uploaded file in place —
  neither `mammoth` (read-only) nor the `docx` package (generate-only) can
  edit an existing `.docx`; true in-place editing would need direct OOXML
  XML surgery, judged too risky for v1 (a bug there produces a corrupt
  file, not just an unstyled one). The regenerated file *is* deliberately
  styled though (see `src/lib/resume/docx_writer.ts`): a bold name header
  with a muted contact line beneath it, colored section headings with a
  bottom rule, bold job-title/company lines, and highlighted bullets shown
  in bold with the same accent color — it just won't match your original
  file's specific fonts, margins, or letterhead.
- **PDF resumes have no structural signal for bullet points** — the parser
  falls back to detecting lines that start with a bullet character (•, -,
  *, etc.), the same limitation the original desktop app had.
- **Job description extraction is best-effort.** It tries a short list of
  selectors for LinkedIn, Indeed, Greenhouse, Lever, and Workday, then falls
  back to a generic "largest visible text block" heuristic. Always review
  the extracted text — the description field is always editable.
- **Autofill is best-effort**, including the resume file upload (built via
  a `DataTransfer`, since a content script can't hand a native OS file to a
  file input the way a desktop automation tool can). Some sites reject
  programmatic file assignment as a bot-detection measure — if that
  happens, attach the resume manually.
- **Ollama tailoring requires one manual setup step** — see below.
- **The extension requests access to all http/https sites** (`host_permissions: ["http://*/*", "https://*/*"]`), and the content script that reads job descriptions and fills forms is statically injected on every page you visit (not just when you click something). This is a real, broad permission — Chrome will show a corresponding warning when you load it. It's necessary because the extension has to work on whatever job site you're currently on, which isn't known in advance; an earlier on-demand-injection design (inject only when a button is clicked) turned out to be unreliable in practice — a click inside the side panel doesn't reliably count as the "user gesture" Chrome's `activeTab` permission expects, so on-demand injection silently failed for both job-description extraction and autofill. The content script itself only *acts* when you explicitly click "Extract from this page" or "Autofill this page" — it doesn't read or send page content on its own.

## Setup

Requires Node.js and npm.

```bash
npm install
npm run build
```

Then in Chrome: go to `chrome://extensions`, enable Developer Mode, click
"Load unpacked", and select the `dist/` folder.

### Using the local-AI (Ollama) backend

Ollama does its own origin allowlisting on the server side, independent of
browser CORS. Confirmed by testing: Ollama's default `OLLAMA_ORIGINS` allows
any `http://127.0.0.1:*` origin, but **does not** include
`chrome-extension://` origins. Without this, the extension's background
service worker will fail to reach Ollama even though `host_permissions` are
declared in the manifest.

To fix it, on Windows:

1. Set the `OLLAMA_ORIGINS` environment variable persistently:
   ```powershell
   setx OLLAMA_ORIGINS "chrome-extension://*"
   ```
   If you want to run this every time and in the same session:
   ```powershell
   $env:OLLAMA_ORIGINS = "chrome-extension://*"
   ollama serve
   ```
   If you'd rather not loosen this globally, scope it to your specific
   extension ID (shown on `chrome://extensions` after loading it unpacked)
   instead of the wildcard.
3. **Verify it actually stuck** — open a *new* terminal window (not the one
   you just ran `setx` in — that window's own session isn't updated by
   `setx`) and run `echo $env:OLLAMA_ORIGINS`. Confirm it prints the full
   value with the trailing `*` intact — some shells (Git Bash / MSYS in
   particular) can silently swallow a bare `*` even inside quotes.
4. **Fully quit Ollama** — right-click its system tray icon and choose
   Quit. Closing a window is not enough; the background server process
   keeps running and keeps its old (empty) `OLLAMA_ORIGINS` in memory.
5. **Relaunch Ollama from the Start Menu or Desktop shortcut** — a fresh
   launch like this reads the current environment correctly. Relaunching
   it *from* an already-open terminal window that predates step 1 will
   instead inherit that terminal's stale environment and silently fail
   the same way — this is exactly what caused a real "still not working"
   report during development, traced to precisely this.

   The rule is simply: **whatever process directly launches the server
   needs `OLLAMA_ORIGINS` in its own environment at the moment it
   launches.** Verified directly: running `ollama.exe serve` alone from a
   fresh terminal with the variable set in that terminal works identically
   to launching it via the tray app (`ollama app.exe`) — the tray app is
   just Ollama's normal Windows GUI wrapper, not a required intermediary
   the server "connects through." Either path works as long as the
   variable is actually present at launch time; the tray app is simply the
   normal way most users run Ollama day to day.

If Ollama isn't reachable, tailoring automatically falls back to the
offline rule-based backend — it never blocks you from tailoring your resume.

## Development

```bash
npm run watch    # rebuild on change (Chrome still needs a manual reload
                  # on chrome://extensions after each rebuild - no MV3 HMR)
npm test         # run the Node unit test suite
npx tsc --noEmit # typecheck
```

**`dist/` is committed to git** (unusual for a build output, done deliberately so the
extension is loadable straight from a clone with no Node/npm needed). This
means it can drift out of sync with `src/` if you forget to rebuild - always
run `npm run build` and `git add dist/` together before committing any
source change.

## Safety-critical behavior (do not weaken these)

- **`src/content/filler_dom.ts` never calls `.click()` on a button or
  `.submit()`/`.requestSubmit()` on a form.** This is enforced by the code
  simply not existing, and backed by a static test
  (`test/node/no_submit_guarantee.test.mjs`) that greps the *built*
  `dist/content.js` bundle for those calls and fails if any are found.
- **`src/lib/resume/numeric_guard.ts`** rejects any AI-rewritten bullet or
  summary that introduces a number/percentage not present in the original.
  This exists because a real model (Mistral-Nemo) invented a fake "25%
  efficiency increase" during testing, despite an explicit prompt
  instruction not to. Don't rely on the prompt alone.
- **`src/lib/resume/rewriter_rule_based.ts`'s `segmentListRuns`** ensures
  bullets are only ever reordered within their own job's bullet list, never
  across a "Job Title, Company" line into a different employer's bullets.
- **`src/lib/autofill/profile_fields.ts`**: the bare keyword `"address"` is
  deliberately excluded from the location field's keywords, because it's a
  substring of "Email Address" and would otherwise hijack email fields (a
  real bug found via testing). If you add new field keywords, check for
  this kind of substring collision against every other field's keywords.

## Verification status

Automated (Node unit tests + real browser-bundle checks via a headless
testing harness) covers: keyword extraction, rule-based reordering
(including the anchor-boundary guarantee), the numeric-fabrication guard,
the diff view, DOCX/PDF parsing and generation (verified both under Node and
as an actual esbuild-bundled browser build), field-mapping (including the
address/email collision fix), DOM autofill against both plain and
React-controlled forms (verified the native-setter + dispatched-event
technique actually updates React's internal state, not just the DOM), the
DataTransfer file-upload technique, the no-submit-click static check, and
Find Jobs' query generation (including the resume-overlap guard dropping a
deliberately fabricated query, and a real call against this machine's
installed Ollama model producing genuinely resume-grounded queries). The
"Open in Google Jobs" button was verified by stubbing `chrome.tabs.create`
to capture the constructed URL rather than actually navigating - confirmed
correctly encoded with the Jobs-vertical parameter, without the tooling
ever touching google.com.

The following can **only** be verified by loading the unpacked extension in
real Chrome (the available development tooling can't open
`chrome://extensions` or drive the real extension harness):

- Manifest correctness and the side panel opening/behaving correctly
- Real message passing between the background service worker, content
  script, and side panel in the actual extension runtime
- `chrome.storage.local` persistence across closing and reopening the panel
- The real Ollama `OLLAMA_ORIGINS` fetch behavior end-to-end from a real
  `chrome-extension://` origin (strongly evidenced but not 100% confirmed —
  see the Ollama section above)
- Autofill against real, currently-live job application pages
- Generated `.docx` visual correctness when opened in Word
