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
   browser (via `mammoth` for DOCX, `pdfjs-dist` for PDF). Upload also
   deterministically merges sections that were probably meant as a
   sub-heading rather than their own section — e.g. a "TECHNICAL SKILLS"
   line appearing right after a near-empty "SKILLS, ACTIVITIES &
   INTERESTS" heading gets folded back in as a bold sub-heading, instead of
   awkwardly splitting into its own section. This only fires for a section
   with very few lines before the next heading appears (never for two
   substantial sections), always runs (no Ollama needed), and is
   unconditional once that trigger is met — it doesn't check whether the
   two headings are actually related in topic. An earlier version asked a
   local LLM to make that judgment call first, which meant it would
   correctly leave two genuinely-unrelated-but-both-short sections
   separate; the current, simpler version can occasionally merge a pair
   like that together too. That trade-off (simpler and always available,
   vs. occasionally over-merging) was made deliberately, in favor of
   simplicity.
   For PDFs specifically: a bullet or heading that's too long for one
   physical line wraps onto the next with no structural marker saying so —
   PDFs have no paragraph concept the way DOCX does. An indentation-based
   heuristic reassembles most of these automatically (also handles
   Wingdings/Symbol-font bullet glyphs commonly produced by Word-to-PDF
   export, not just standard Unicode bullets). For the rarer case where a
   section's wrapped lines have *neither* a bullet glyph nor a hanging
   indent to go on, the Ollama backend (when selected) asks the local LLM
   to judge line-wrap boundaries from sentence content instead — genuinely
   helpful but not perfect (see the formatting note below for the honest
   caveat on this specific piece).
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
   navigate to `google.com` for that reason. Every suggested query is
   checked against your resume's own text before being shown - at least
   half its words must actually appear in your resume, not just one - and
   anything below that bar is dropped from the results but still shown in a
   separate "dropped" list so you can see what the model actually said
   instead of it silently disappearing. A single shared word turned out not
   to be a strong enough bar: a weak model asked to vary its phrasing can
   end up mostly reusing the prompt's own worked example rather than your
   resume, and a query like that can still accidentally share one common
   word ("senior," "python") with your real resume while describing a
   fabricated, unrelated role. **Model quality varies a lot** — small models
   (under ~2B parameters, e.g. `tinyllama`, `qwen2:0.5b`) frequently can't
   reliably follow the JSON-output and query-format constraints at all and
   will just fall back to the rule-based suggestions; if that keeps
   happening, try a larger installed model.
3. **Tailor & Review** — reorders/highlights your most relevant bullets
   (offline, no AI needed), or optionally rewords them with a local Ollama
   model. Shows a diff before you commit to anything.
4. **Apply** — download the tailored resume. For `.docx` uploads, this
   first tries to edit your original file **in place** (real OOXML XML
   surgery on `word/document.xml` — reorders/rewords the exact paragraphs
   in your original file, preserving its fonts, margins, and layout
   exactly). If that can't be done safely for any reason, it transparently
   falls back to generating a fresh, styled `.docx` instead (name/contact
   header, colored section headings, bold job titles — see the formatting
   note below) — never a corrupted file. The download status tells you
   which one you got. Also available: autofill the form on the current
   page (name, email, phone, links, etc. — whatever it can confidently
   match). Stops before Submit, always.
5. **Settings** — your profile info (used for autofill) and Ollama config,
   stored only in this browser's local extension storage.

## Known limitations (read before relying on this)

- **In-place editing of your original `.docx` isn't guaranteed** — it's
  attempted first (see `src/lib/resume/docx_inplace.ts`), and only used if
  every rewritten/reordered bullet can be matched back to its exact source
  paragraph in your original file with zero ambiguity, the reordering
  doesn't need to cross something like a table cell boundary, and the
  edited result still parses cleanly afterward as a sanity check. Any
  doubt at any point — never a guess — falls back to the same regenerated,
  styled `.docx` this extension always produced before (see
  `src/lib/resume/docx_writer.ts`: bold name header, muted contact line,
  colored section headings with a bottom rule, bold job-title/company
  lines). The download status after clicking "Download tailored .docx"
  always tells you honestly which one you got. PDF-sourced resumes always
  use the regenerated path — there's no original `.docx` to edit.
- **PDF resumes have no structural signal for bullet points or paragraph
  boundaries** — the parser detects bullets via a leading-glyph heuristic
  (standard characters like •/-/*, plus the Wingdings/Symbol-font
  Private-Use-Area glyphs Word-to-PDF export commonly uses instead), and
  reassembles bullets/headings that wrap across multiple physical lines
  using an indentation heuristic (wrapped continuation text is usually
  hanging-indented further right than the line that started it), plus a
  "Label: description" heuristic for a line that starts a new entry
  without any indent or glyph signal at all. Real resumes were used to
  find and fix all of these, including a genuinely hard case (a section
  whose wrapped lines had *neither* a bullet glyph nor a hanging indent to
  go on) - see "PDF line-wrap reconstruction" above for how that was
  actually resolved, and don't assume a fix worked without testing it
  against real Ollama calls first, since an earlier, plausible-sounding
  attempt at that fix turned out to have its own real, LLM-specific
  failure mode. **PDF-sourced lines are never bolded in the output**,
  even genuine job-title/project-title anchor lines: an earlier version
  guessed "is this a title" from a line's length, which reliably misfired
  on imperfectly reconstructed fragments (a stray, unrelated piece of a
  wrapped sentence can easily be short by pure coincidence, with nothing
  about being short making it a title). There's no reliable signal in a
  PDF for "was this originally bold" the way DOCX has (see below), so
  rather than keep tuning a guess that kept finding new ways to be wrong,
  PDF-sourced lines are rendered plain uniformly in the output instead.
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
<<<<<<< HEAD
=======
   
>>>>>>> 752aa24f49e8a1566abd39926c042f5b3c4fb83f
   If you want to run this every time and in the same session:
   ```powershell
   $env:OLLAMA_ORIGINS = "chrome-extension://*"
   ollama serve
   ```
<<<<<<< HEAD
   If you'd rather not loosen this globally, scope it to your specific
   extension ID (shown on `chrome://extensions` after loading it unpacked)
   instead of the wildcard.
3. **Verify it actually stuck** — open a *new* terminal window (not the one
=======
   BASH VERSION:
   ```bash
   export OLLAMA_ORIGINS="chrome-extension://*"
   ollama serve
   ```
   
   If you'd rather not loosen this globally, scope it to your specific
   extension ID (shown on `chrome://extensions` after loading it unpacked)
   instead of the wildcard.
1. **Verify it actually stuck** — open a *new* terminal window (not the one
>>>>>>> 752aa24f49e8a1566abd39926c042f5b3c4fb83f
   you just ran `setx` in — that window's own session isn't updated by
   `setx`) and run `echo $env:OLLAMA_ORIGINS`. Confirm it prints the full
   value with the trailing `*` intact — some shells (Git Bash / MSYS in
   particular) can silently swallow a bare `*` even inside quotes.
<<<<<<< HEAD
4. **Fully quit Ollama** — right-click its system tray icon and choose
   Quit. Closing a window is not enough; the background server process
   keeps running and keeps its old (empty) `OLLAMA_ORIGINS` in memory.
5. **Relaunch Ollama from the Start Menu or Desktop shortcut** — a fresh
=======
2. **Fully quit Ollama** — right-click its system tray icon and choose
   Quit. Closing a window is not enough; the background server process
   keeps running and keeps its old (empty) `OLLAMA_ORIGINS` in memory.
3. **Relaunch Ollama from the Start Menu or Desktop shortcut** — a fresh
>>>>>>> 752aa24f49e8a1566abd39926c042f5b3c4fb83f
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
- **`src/lib/resume/docx_inplace.ts`'s `tryGenerateInPlaceDocx` never
  returns an edited file without validation, and never throws.** Any
  doubt anywhere in the process - an unmatched or ambiguous bullet, a
  paragraph too structurally complex to safely rewrite, a reorder that
  would cross something like a table-cell boundary, or the edited output
  failing to reparse afterward - resolves to `{ blob: null, reason }`,
  which `generate_output_docx.ts` treats as "use the regenerated,
  always-safe `.docx` instead." Don't weaken any of these gates to make
  in-place editing succeed more often - a corrupted or silently-wrong
  output file is never an acceptable trade for a higher success rate.

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
installed Ollama model producing genuinely resume-grounded queries), and
deterministic sparse-section merging (`src/lib/resume/section_merge.ts`) -
covered by Node tests (candidate detection, the merge correctly preserving
the sub-heading as a bold anchor line and renumbering `Bullet.order`,
no-op behavior when there's nothing to merge, and the explicitly-accepted
trade-off of also merging two genuinely unrelated sparse sections, since
this version doesn't judge topical relation the way an earlier,
since-removed LLM-based version did). The
"Open in Google Jobs" button was verified by stubbing `chrome.tabs.create`
to capture the constructed URL rather than actually navigating - confirmed
correctly encoded with the Jobs-vertical parameter, without the tooling
ever touching google.com.

**PDF line-wrap reconstruction** (`src/lib/resume/parse_pdf.ts`'s
`mergeWrappedLines`/`looksLikeLabeledEntry`, `src/lib/resume/pdf_line_reconstruct.ts`)
went through several real iterations against an actual problem resume
before landing on its current design, each one driven by directly testing
against real Ollama calls rather than assuming a fix worked:
- A first version asked one LLM call per PAGE, batching every line's
  merge/no-merge decision into one JSON response. Repeated testing showed
  this had a *deterministic* blind spot (the same wrong line, every single
  time, across identical repeated calls) - re-asking or voting across
  multiple calls to the same model would never have fixed it, and testing
  different models found each one made different, often worse mistakes
  (a majority vote across models would have overruled the one model that
  got the most lines right).
- Switching to one isolated, focused question per adjacent line pair
  ("does line B continue line A?") fixed that blind spot, but surfaced a
  different failure mode when tested against the FULL real problem
  section: comparing an ambiguous pair against the growing merged
  accumulator (rather than the clean original row) let one wrong "yes,
  merge" guess cascade, sweeping several unrelated bullets into one
  nonsensical blob. Comparing against the original, unmodified adjacent
  row instead contains any mistake to just the one pair it affects.
- The specific pair the LLM stayed unreliable on, even after that fix, all
  shared one thing: the new entry it was confused about followed a
  "Label: description" convention (e.g. "Python language:", "MySQL and
  SQLite Database:") - a deliberate, common resume-formatting convention
  that a simple, deterministic regex (`looksLikeLabeledEntry`) recognizes
  far more reliably than the LLM's judgment did. Checking for this
  up front - alongside the existing bullet-glyph and hanging-indent
  checks - resolved the remaining failure entirely and, as a side benefit,
  needs noticeably fewer LLM calls per resume.

Verified with real, repeated calls against this machine's installed
`mistral-nemo` model against the exact real "Technical Skills" section
that motivated this feature: 3 repeated runs all produced the identical,
fully correct grouping. Node tests cover the indentation heuristic, the
label-detection heuristic, the LLM path's selective invocation (skipped
entirely for glyph/indent/label-confident lines), the cascade-containment
behavior specifically, and fallback to the indentation heuristic on any
failure.

**In-place `.docx` editing** (`src/lib/resume/docx_xml.ts`,
`docx_paragraphs.ts`, `docx_match.ts`, `docx_inplace_edit.ts`,
`docx_inplace.ts`, `generate_output_docx.ts`) has real coverage at two
levels. Node tests, using real `docx`-package-generated fixtures and a
`@xmldom/xmldom`-polyfilled `DOMParser`/`XMLSerializer`, cover: a no-op
parse/serialize/rezip round trip; malformed-XML detection (both the
native-browser `<parsererror>`-element failure shape and the polyfill's
throw shape); order-anchored bullet matching, including two bullets with
*identical text in different sections* being matched to their correct,
distinct paragraphs; reordering that reproduces `TailoredBullet.newOrder`
while leaving an untouched run's formatting alone; text replacement that
preserves other runs' formatting and sets `xml:space="preserve"`
correctly; the mandatory post-edit reparse-validation gate actually
rejecting a bad edit; and adversarial fixtures (non-zip bytes, a missing
`word/document.xml`, a two-column table layout, a `w:sdt`-wrapped bullet)
all producing a clean fallback, never a throw or a corrupted file.
Separately, the real esbuild-bundled `dist/` build was driven end-to-end
through the browser-automation tool - uploading a real `.docx` fixture,
tailoring it, downloading it, and inspecting the result's raw
`word/document.xml` inside the actual browser to confirm native
`DOMParser`/`XMLSerializer`/`JSZip` (not the Node polyfill) produced a
correctly reordered, still-valid document with its XML declaration
intact, plus a simulated panel close/reopen confirming the original file
bytes round-trip through `chrome.storage.local` correctly. **What no tool
here can verify: actually opening an in-place-edited file in real
Microsoft Word.** The reparse gate only proves `mammoth` (a lenient
reader) can still extract plausible content - not that Word's stricter
validator accepts the file without a repair prompt. The matching logic is
deliberately conservative (biased toward the always-safe regenerated
fallback) specifically because of this gap.

The following can **only** be verified by loading the unpacked extension in
real Chrome (the available development tooling can't open
`chrome://extensions` or drive the real extension harness):

- Manifest correctness and the side panel opening/behaving correctly
- Real message passing between the background service worker, content
  script, and side panel in the actual extension runtime
- `chrome.storage.local` persistence across closing and reopening the panel
  in the real extension runtime (simulated in-memory-store persistence,
  including of the raw original `.docx` bytes, was verified as above)
- Actually opening a downloaded (in-place-edited or regenerated) `.docx`
  in Microsoft Word
- The real Ollama `OLLAMA_ORIGINS` fetch behavior end-to-end from a real
  `chrome-extension://` origin (strongly evidenced but not 100% confirmed —
  see the Ollama section above)
- Autofill against real, currently-live job application pages
