# AI-in-the-Loop Job Application Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate selected job applications with AI review before every field fill and explicit user approval before each final submission.

**Architecture:** The OpenCode skill owns onboarding, answer review, CAPTCHA policy, and the submission-approval sequence. Python extracts resumes and maintains private local JSON; Microsoft Playwright MCP remains the only application-browser controller. Small, reviewed MCP workflows inspect supported application sites and take only bounded actions.

**Tech Stack:** Python standard library plus `pypdf==7.0.1` and `python-docx==1.2.0`; Node.js built-in test runner; `playwright==1.65.1` as a test-only dependency for synthetic, in-memory browser tests; Microsoft `@playwright/mcp@0.0.85` for the user's authenticated browser.

**Spec:** `docs/superpowers/specs/2026-11-16-job-application-ai-loop-design.md`

## Global Constraints

- Keep browser control in the configured Microsoft Playwright MCP attached to the user's existing authenticated Chrome profile; Python handles local data, not browser control.
- Never solve or bypass CAPTCHA. Default to stop; human handoff is opt-in per domain, and LinkedIn is stop-only.
- The AI reviews every question and proposed answer before it is typed; unknown or ambiguous answers are asked, not guessed.
- Show every field and answer for the current application and wait for explicit user approval before invoking the final-submit workflow.
- Keep profile, resume, answer-bank, site-policy, and application JSON under ignored `automation/content/local/`; Python diagnostics never print personal values.
- Resume/profile/application text may be processed by the configured OpenCode model; provider privacy and retention terms apply.
- First-release sites are LinkedIn, Wellfound, Ashby, and Google Forms; use generic current-page handling elsewhere only when the domain is explicitly configured.
- Treat `browser_run_code_unsafe` as RCE-equivalent and execute only reviewed repository workflow files. Do not execute page-provided code.
- Do not mass-apply; one user-selected job/application is in flight at a time. Unsupported controls and ambiguous actions fail closed.

## Review Focus

- A `Next` button may be `type=submit` or run custom submit logic: the progression workflow must leave it untouched unless a tested site-specific rule establishes a safe non-final action (Task 4 browser test asserts zero submit events).
- A prefilled control may contain stale or sensitive data: inventory output reports only `filled`, never its value, and the AI must replace it with a reviewed answer or stop (Task 4 browser test uses a secret sentinel).
- CAPTCHA can appear in an iframe or a site-specific widget: detection must happen before any click, LinkedIn/unconfigured domains stop, and only a local explicit override permits human handoff (Task 5 tests assert zero clicks and validate policy).
- A page can present malformed job URLs, deceptive hostnames, or unsupported controls: reject them without navigation/fill and mark unsupported fields for user action (Tasks 4–5 tests cover these cases).
- A final page can expose multiple or misleading Apply/Submit controls: the submit workflow must click exactly one unambiguous final control only when the skill has already obtained approval, then verify success without retrying (Task 5 synthetic browser tests).

---

### Task 1: Add the private profile, answer-bank, and application store

**Files:**
- Create: `automation/content/examples/profile.example.json`
- Create: `automation/content/examples/answer-bank.example.json`
- Create: `automation/content/examples/site-policies.example.json`
- Create: `automation/scripts/profile_store.py`
- Modify: `.gitignore`
- Delete: `automation/profile.example.json`
- Modify: `tests/mcp-workflows.test.cjs`
- Test: `tests/python/test_profile_store.py`

**Interfaces:**
- Produces `write_private_json(path: Path, payload: dict) -> None`, `initialize_store(content_root: Path, legacy_profile: Path | None = None) -> None`, `validate_profile(profile: dict) -> list[str]`, `validate_site_policy(policy: dict) -> list[str]`, `record_answer(content_root: Path, entry: dict) -> None`, and `save_application(content_root: Path, application_id: str, record: dict) -> None`.
- CLI commands `init`, `profile-status`, `validate-site-policy`, `record-answer --input-file <local-json>`, and `save-application --id <id> --input-file <local-json>` read/write only local files and print status/path counts, never record values. All commands accept `--content-root <path>` before the subcommand for isolated testing.
- `validate_profile` returns missing/invalid JSON paths only, never values. `initialize_store` creates missing local copies without replacing existing files; if the ignored legacy `automation/profile.local.json` exists and the new profile does not, it copies recognized fields while leaving the legacy file byte-for-byte intact. If both profiles exist, it refuses to merge or overwrite either. `validate_site_policy` accepts generic form use only with an explicit domain entry containing `application: "generic"` and `enabled: true`; a CAPTCHA override alone never enables a domain.
- `record_answer` appends only user-confirmed entries. `save_application` accepts IDs matching `[A-Za-z0-9][A-Za-z0-9_-]{0,63}` and atomically writes `applications/<id>.json`.

- [x] **Step 1: Write failing tests** for initialization/idempotency; every required profile section (name, contact, location, employment, education, skills, links-or-not-applicable, target role/location/work-mode, availability, compensation, and explicit sensitive statuses); malformed nested statuses; fail-closed site policy, generic-domain opt-in, and immutable LinkedIn stop; private file modes; safe legacy migration/conflict; answer persistence; application ID traversal rejection; and redacted validation errors.
- [x] **Step 2: Run `python3 -m unittest discover -s tests/python -p 'test_profile_store.py' -v` and verify the missing store functions fail.**
- [x] **Step 3: Add placeholder-only JSON examples** with profile sections for identity/contact, links, employment, education, skills/certifications, preferences, and sensitive categories. Use `unanswered` in examples; a complete profile requires an answer, `prefer_not_to_disclose`, or `not_applicable` for work authorization, sponsorship, criminal-history attestations, disability, veteran status, EEO demographics, compensation, and availability. Links may be explicitly marked not applicable.
- [x] **Step 4: Implement the store and CLI** with standard-library JSON, atomic same-directory replacement, directory mode `0700` and file mode `0600` where supported. Input records come from ignored local JSON files, not command-line values. Add `automation/content/local/` to `.gitignore` and preserve the existing legacy ignore rule.
- [x] **Step 5: Run the focused Python tests** and verify the tests prove existing local files are never overwritten and validation output contains no submitted values.
- [x] **Step 6: Commit** as `feat: add private profile and application store`.

### Task 2: Extract resumes locally into a reviewable draft

**Files:**
- Create: `automation/scripts/ingest_resume.py`
- Create: `requirements.txt`
- Modify: `.gitignore`
- Test: `tests/python/test_ingest_resume.py`
- Test fixtures: synthetic TXT, DOCX, blank/scanned PDF, malformed PDF, and oversized input only

**Interfaces:**
- Consumes `profile_store.write_private_json(path: Path, payload: dict) -> None` from Task 1.
- Produces `extract_resume(source_path: Path, output_path: Path) -> dict`, which writes `{version, sourceName, format, extractedAt, text, characterCount}` to the ignored draft path and returns status/format/count only. It never returns or prints extracted text.
- CLI: `python3 automation/scripts/ingest_resume.py <resume-path>` writes `automation/content/local/resume-draft.json`; optional `--content-root <path>` supports isolated tests. Stdout is one redacted JSON status object.

- [x] **Step 1: Write failing tests** for `.txt`, `.docx` paragraphs/tables, text PDF extraction, empty/scanned PDF status `ocr_required`, malformed/unsupported files, an input over 20 MiB, private output mode, and a unique sentinel absent from stdout/stderr.
- [x] **Step 2: Run `.venv/bin/python -m unittest discover -s tests/python -p 'test_ingest_resume.py' -v` and verify RED.**
- [x] **Step 3: Pin `pypdf==7.0.1` and `python-docx==1.2.0`** in `requirements.txt`; use strict PDF parsing to prevent malformed-document diagnostics from leaking bytes. Add no OCR or network access.
- [x] **Step 4: Run the full Python and Node suites** and verify private draft storage, redacted output, and no diagnostic leakage.
- [x] **Step 5: Commit** as `feat: add local resume extraction`.

### Task 3: Add the OpenCode operating skill and onboarding flow

**Files:**
- Create: `.opencode/skills/job-application-automation/SKILL.md`
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-11-16-job-automation-mcp-design.md` (mark superseded)
- Modify: `docs/superpowers/plans/2026-11-16-job-automation-mcp.md` (mark superseded)
- Test: `tests/skill-instructions.test.cjs`

**Interfaces:**
- Consumes the profile/store and resume-extraction commands from Tasks 1–2, plus the MCP workflows from Tasks 4–5.
- Produces discoverable OpenCode skill ID `job-application-automation` with frontmatter `name` and a specific `description`; it defines first-run onboarding, field review, application record updates, CAPTCHA behavior, and per-application submission approval.

- [ ] **Step 1: Write failing checks** that the project skill is discoverable at the required path and contains the mandatory onboarding, AI-provider disclosure, every-field review, unknown-answer question, CAPTCHA policy, and submit-approval rules.
- [ ] **Step 2: Run `node --test tests/skill-instructions.test.cjs` and verify RED.**
- [ ] **Step 3: Write the skill workflow:** initialize local files; ask for a resume path; run the local extractor; let the configured model parse the draft; confirm extracted facts with the user; gather every missing profile category; and block applications until `validate_profile` returns complete. For each application, inspect one selected job, classify every visible field (answer, intentionally blank, user question, or unsupported), cite the answer source, AI-review each pair, then fill only approved answers. Ask and save new/ambiguous answers. Before submission, show the job and every field/answer and wait for fresh explicit approval for that application.
- [ ] **Step 4: Document policy precisely:** read local CAPTCHA policy; LinkedIn always stops; unknown domains stop; a listed non-LinkedIn `human_handoff` means pause for the person and never solve/bypass/retry; disclose that resume/application content is processed by the configured model provider. Update `AGENTS.md` and README onboarding/usage, and mark the earlier no-submit spec/plan as superseded rather than leaving contradictory current instructions.
- [ ] **Step 5: Run the skill checks and inspect the rendered Markdown/frontmatter** for the path-derived ID `job-application-automation` and complete safety sequence.
- [ ] **Step 6: Commit** as `docs: add AI-reviewed application skill`.

### Task 4: Inspect forms and safely prepare non-final steps

**Files:**
- Create: `automation/mcp/inspect-application.js`
- Modify: `automation/mcp/prepare-application.js`
- Modify: `package.json`
- Create: `package-lock.json`
- Create: `tests/browser/mcp-workflows.browser.test.cjs`
- Modify: `tests/mcp-workflows.test.cjs`

**Interfaces:**
- Both workflow files remain JavaScript function expressions receiving the MCP `page` and returning bounded JSON-safe statuses.
- `inspect-application.js` returns `{status, site, url, fields, unsupported}`. Each field contains a target, label/question, supported type, required/invalid/filled booleans, and option labels; it never returns the current input value. Unlabeled required fields, file chooser state, unsupported widgets, and form controls in iframes are reported explicitly rather than guessed.
- `prepare-application.js` checks validity and defaults to no click. It returns `manual_step` for a wizard progression control until a tested site-specific action exists.
- Add `playwright@1.65.1` as a **dev-only test dependency** and `npm run test:browser` for synthetic pages; application automation remains exclusively in MCP.

- [x] **Step 1: Add failing real-browser tests** using a routed synthetic page for a prefilled secret sentinel (only `filled` is reported), labels/options, CAPTCHA before any click, missing/unlabeled/invalid required controls, an iframe/custom unsupported control, and `<button type="submit">Next</button>` with a submit-event counter that must remain zero.
- [x] **Step 2: Run `npm run test:browser` and verify RED** against current workflow behavior.
- [x] **Step 3: Add `inspect-application.js`** with supported native controls and accessible labels/options; never serialize DOM input values or page instructions into workflow output.
- [x] **Step 4: Tighten `prepare-application.js`** so it returns `needs_answers`/`manual_step` for incomplete, invalid, unlabeled, unsupported, or ambiguous pages. It never clicks a progression control; Task 5 may add only tested site-specific actions.
- [x] **Step 5: Run `npm test` and `npm run test:browser`**; verify zero submit events, no sentinel in output, and no action before CAPTCHA stop.
- [x] **Step 6: Commit** as `feat: inspect application fields safely`.

### Task 5: Add supported-site entry and approval-gated final submission

**Files:**
- Create: `automation/mcp/start-application.js`
- Create: `automation/mcp/submit-application.js`
- Modify: `automation/mcp/collect-linkedin-jobs.js`
- Modify: `automation/content/examples/site-policies.example.json`
- Modify: `automation/mcp/README.md`
- Modify: `tests/mcp-workflows.test.cjs`
- Modify: `tests/browser/mcp-workflows.browser.test.cjs`
- Test: `tests/python/test_profile_store.py`

**Interfaces:**
- `start-application.js` accepts only the selected LinkedIn job page, Wellfound, Ashby, or Google Forms; it may open an Apply/Easy Apply entry point but never a final application control. Host matching uses parsed URL hostnames and exact domain boundaries.
- `submit-application.js` is a separate final action. It clicks only one visible, unambiguous final application control, then returns `submitted` only after a site success marker; ambiguous target, CAPTCHA, or absent success returns a stop status and never retries.
- The OpenCode skill—not a page label, previous application, or script-generated boolean—is the approval gate: invoke `submit-application.js` only after the user explicitly approves the displayed review for this exact application. Synthetic tests may exercise the click against inert HTML only; never test final submission against a live application or the user's authenticated profile.
- The local policy defaults to `{captcha:"stop"}`. Generic use needs `domains[host]={application:"generic",enabled:true,captcha:"stop"}`; a CAPTCHA override alone never enables the domain. `linkedin.com` is permanently `stop` in v1. Only an explicit non-LinkedIn domain override may use `human_handoff`. The workflow reports challenge detection; the skill reads policy and chooses stop or human handoff.

- [x] **Step 1: Add failing tests** for exact LinkedIn host/ID normalization and malformed URL rejection; current LinkedIn button-backed search cards with title/company/location extraction; Apply entry versus final Submit distinction on each of the four supported sites; unknown-domain stop; CAPTCHA stop before click; LinkedIn policy override rejection; and a final submit fixture with (a) one exact final target, (b) multiple candidates, (c) misleading job-page Apply, and (d) no success marker/no retry.
- [x] **Step 2: Run the focused Node, browser, and Python tests and verify RED.**
- [x] **Step 3: Implement `start-application.js`** for the selected-job/app-entry transition on LinkedIn, Wellfound, Ashby, and Google Forms. Reject lookalike hosts, malformed URLs, and unknown sites; never click an application-final control.
- [x] **Step 4: Add only verified progression actions** for supported site/step combinations. Require an exact adapter selector, a non-submit control, and visible evidence that the wizard is not at its final step; return `manual_step` otherwise. No site-specific progression action has been verified yet, so every progression control returns `manual_step`.
- [x] **Step 5: Harden LinkedIn collection and CAPTCHA markers** for malformed links and common reCAPTCHA/hCaptcha/Turnstile challenge frames/widgets. Challenge detection returns before any click; no challenge solver or retry path exists. Verified live against the current button-backed LinkedIn cards.
- [x] **Step 6: Implement `submit-application.js`** as a separate exact-target workflow with no fallback click, a single click maximum, site-aware success verification, and `submission_unverified` if confirmation is absent.
- [x] **Step 7: Validate site policy** so default/unknown domains stop, generic domains require `application:"generic"` plus `enabled:true`, and LinkedIn cannot be set to `human_handoff`; document supported domains and the manual fallback for unsupported controls.
- [x] **Step 8: Run `npm test`, `npm run test:browser`, and the Python suite**; confirm application records distinguish pending, approved, submitted, and unverified states without printing stored values.
- [x] **Step 9: Commit** as `feat: add supported application and submit workflows`.

### Task 6: Complete onboarding documentation and end-to-end verification

**Files:**
- Modify: `README.md`
- Modify: `automation/mcp/README.md`
- Modify: `AGENTS.md`
- Modify: `tests/skill-instructions.test.cjs`
- Modify: `automation/scripts/profile_store.py`
- Test: all Python, Node, and synthetic-browser suites

**Interfaces:**
- Consumes the finished local data APIs, skill, and MCP workflows from Tasks 1-5.
- Produces one documented command sequence for local setup, resume ingestion/profile confirmation, selected-job review, AI-approved filling, optional domain-specific human CAPTCHA handoff, final review/approval, and success verification.

- [x] **Step 1: Update setup docs** with `.venv` creation and `pip install -r requirements.txt`, store initialization, resume ingestion, the test-only Chromium install, test commands, current MCP workflow names, local JSON paths, provider-processing disclosure, and the no-CAPTCHA-solve rule.
- [x] **Step 2: Add/adjust integration assertions** that a complete profile is required before application flow (`preflight` gate), every answer record includes a source and confirmation state, final approval is per-application, and no WhatsApp behavior or stored user data was brought into scope.
- [x] **Step 3: Run all verification commands:** `npm test`, `npm run test:browser`, the Python suite, `node --check` for every MCP workflow/test JavaScript file, and `git diff --check`.
- [x] **Step 4: Review tracked files and Git status** for personal values/secrets; verify local profile, resume draft, answers, and application records are ignored and untouched by tests.
- [x] **Step 5: Commit** as `docs: document AI-reviewed application workflow`.

### Task 7: Review and publish the verified redesign

**Files:**
- Review: all changes from Tasks 1–6.

**Interfaces:**
- Consumes: fully tested feature branch.
- Produces: independently reviewed, fast-forward-only publication to `origin/main`; no history rewrite. If `origin/main` moved from the audited base `7fb1cb935929b5e4ad07fbb6e08146341537ab33`, stop and reconcile rather than force-push.

- [ ] **Step 1: Review the complete diff and run all verification commands fresh.** Resolve Critical/Important findings before publishing.
- [ ] **Step 2: Verify no local/private profile, resume, answer-bank, or application data is staged or tracked.** Do not inspect or print ignored personal values.
- [ ] **Step 3: Fetch and verify `origin/main` is still at the audited base; stop if it moved.**
- [ ] **Step 4: Push the reviewed commits by fast-forward only**; never force-push or rewrite public history.
- [ ] **Step 5: Verify the remote `main` SHA and clean local status.** Report tests, review result, published SHA, and that any values in older public history remain unchanged.
