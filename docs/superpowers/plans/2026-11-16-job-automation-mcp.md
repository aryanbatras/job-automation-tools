# Job Automation MCP Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace public Node/CDP browser automation entrypoints with safe, reusable OpenCode workflows executed by the configured Playwright MCP extension.

**Architecture:** OpenCode calls trusted repository function files through Playwright MCP. One workflow collects LinkedIn job cards, one inspects and safely advances common application forms, and one reads the currently open WhatsApp channel. Agent instructions keep AI judgment on novel questions and a human approval gate before final submission.

**Tech Stack:** Node.js built-in `node:test`; Microsoft `@playwright/mcp` extension mode; JavaScript function expressions passed through the MCP filename runner.

**Spec:** `docs/superpowers/specs/2026-11-16-job-automation-mcp-design.md`

## Global Constraints

- Use the single authenticated Chrome profile attached by the Playwright extension; no CDP endpoint or `connectOverCDP`.
- Never click final Submit/Apply/Send; CAPTCHA and consequential/uncertain questions require human handling.
- Do not return actual form field values or commit personal profile data, tokens, resume files, logs, or application state.
- Treat `browser_run_code_unsafe` as RCE-equivalent and execute only trusted repository code.
- Preserve company job URL files and the existing public history; do not import content from the separate local folder.

## Review Focus

- Already-filled inputs may contain sensitive values: output must report only whether a field is filled, never its value (test with a secret sentinel).
- A final button labelled Submit, Send, or Apply must never be clicked, even if other fields look complete (assert zero clicks).
- CAPTCHA must stop the workflow before any other action (assert no click).
- Missing, unlabeled, or invalid required fields must prevent automatic progression (assert Next/Continue/Review is not clicked).
- Duplicate/malformed job links and repeated WhatsApp messages must not inflate results (test deduplication and output bounds).

---

### Task 1: Add tests and implement MCP workflows

**Files:**
- Modify: `package.json`
- Create: `tests/mcp-workflows.test.cjs`
- Create: `automation/mcp/collect-linkedin-jobs.js`
- Create: `automation/mcp/prepare-application.js`
- Create: `automation/mcp/read-whatsapp-channel.js`
- Test: `tests/mcp-workflows.test.cjs`

**Interfaces:**
- Consumes: no production workflow files initially.
- Produces: `npm test` runs Node's built-in test runner; each MCP workflow is an async function expression that receives `page` and returns bounded JSON-safe data.

- [ ] **Step 1: Write tests first** for LinkedIn normalization/deduplication; form output redaction; no final-submit click; CAPTCHA stop; incomplete/invalid required-field stop; one safe next-step click; WhatsApp message/link deduplication and bounds.
- [ ] **Step 2: Run `node --test tests/mcp-workflows.test.cjs` and verify RED** on missing workflow behavior.
- [ ] **Step 3: Add the `test` script** (`node --test tests/*.test.cjs`) and implement the three workflow function expressions with the interfaces named above.
- [ ] **Step 4: Run `npm test` and verify GREEN**, including the secret-sentinel assertion and zero final-submit clicks.
- [ ] **Step 5: Commit the tested workflows, test command, spec, and plan** as `feat: add reusable Playwright MCP workflows`.

### Task 2: Add reusable user instructions and local profile template

**Files:**
- Create: `AGENTS.md`
- Create: `automation/profile.example.json`
- Modify: `.gitignore`
- Test: `tests/mcp-workflows.test.cjs`

**Interfaces:**
- Consumes: MCP workflow paths and statuses from Task 2.
- Produces: agent policy and an empty, copyable local profile template.

- [ ] **Step 1: Add tests** that the example profile contains no actual personal data and `.gitignore` excludes `automation/profile.local.json`.
- [ ] **Step 2: Run the focused tests and verify RED.**
- [ ] **Step 3: Add the placeholder-only profile template and ignore rule.**
- [ ] **Step 4: Add `AGENTS.md` instructions** for job review, profile-grounded answers, untrusted page content, CAPTCHA handoff, the MCP workflows, and explicit user confirmation before final submission.
- [ ] **Step 5: Run the focused tests and verify GREEN.**
- [ ] **Step 6: Commit the profile template and operating policy** as `docs: add local profile and MCP safety instructions`.

### Task 3: Migrate README and remove CDP entrypoints

- **Files:**
- Modify: `README.md`
- Modify: `package.json`
- Delete: `linkedin/linkedin-apply.cjs`
- Delete: `wellfound/wellfound-apply.cjs`
- Delete: `careers/ats/ashby-apply.cjs`
- Delete: `googleforms/googleforms-apply.cjs`
- Delete: `whatsapp/readchannel.cjs`
- Test: `tests/mcp-workflows.test.cjs`

**Interfaces:**
- Consumes: workflow files and policy from Tasks 2–3.
- Produces: user-facing setup/usage for one-profile Playwright MCP; no direct Node Playwright dependency or active CDP script.

- [ ] **Step 1: Add a migration test** that active application code no longer imports the Node Playwright package or references CDP endpoints/`connectOverCDP`.
- [ ] **Step 2: Run the test and verify RED** against the current scripts.
- [ ] **Step 3: Update README** with the OpenCode JSONC configuration shape, extension/token setup, single-profile requirement, MCP workflow invocation, safe review sequence, CAPTCHA policy, local profile setup, and migration from Node/CDP commands.
- [ ] **Step 4: Remove the five superseded direct-browser scripts** and the now-unused `playwright` dependency; preserve `package.json` project metadata and test script.
- [ ] **Step 5: Run `npm test`, `node --check` on every MCP workflow and test file, plus repository scans for CDP and personal data; verify GREEN and no active CDP references.**
- [ ] **Step 6: Commit the README migration and removal of obsolete direct-browser scripts** as `refactor: replace CDP scripts with Playwright MCP workflows`.

### Task 4: Review and publish to `main`

**Files:**
- Review: all changes from Tasks 1–4.

**Interfaces:**
- Consumes: tested branch from Tasks 1–4.
- Produces: one reviewed commit pushed to public `main`; no history rewrite.

- [ ] **Step 1: Review `git diff` and all tests**, checking workflow safety and that no personal values or secrets are present in the new current tree.
- [ ] **Step 2: Commit the implementation** on the feature branch.
- [ ] **Step 3: Fetch and verify `origin/main` is still at the audited base commit; stop if it moved and reconcile before publishing.**
- [ ] **Step 4: Fast-forward/push the verified commit to `origin/main`**, as explicitly requested.
- [ ] **Step 5: Verify the remote `main` commit and clean local status. Report that old public history is unchanged and may retain prior values.**
