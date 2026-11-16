# Job Automation MCP Design

## Intent

Move the public Job Automation Tools repository from Node scripts attached to a separately launched Chrome CDP endpoint to reusable OpenCode workflows using the configured Playwright MCP extension and the user's one authenticated Chrome profile. Reduce repetitive browser orchestration while preserving AI judgment for job fit, user-specific answers, and exceptions.

## Goals

- Document the `@playwright/mcp` extension setup in `~/.config/opencode/opencode.jsonc`, including the single-profile setup. The official extension mode does not require a separate token; any credential required by a custom deployment must remain local-only.
- Provide reusable MCP-callable workflows to collect LinkedIn job cards, inspect application forms, advance only safe non-submit steps, and read an already-open WhatsApp channel.
- Keep profile-specific values out of public source and provide a blank, non-personal example profile for each user to copy locally.
- Stop before final application submission. Never guess consequential answers or solve/bypass CAPTCHA; return those cases for human judgment/intervention.
- Keep job URLs and ignored local tracking data available.
- Add automated tests for workflow output redaction, CAPTCHA and submit stops, required-field validation, and safe form progression.

## Non-goals

- Rewriting the repository's public Git history or purporting to erase information from prior commits, forks, caches, or clones.
- Fully automatic job selection, answering novel screening questions, CAPTCHA handling, or final submission.
- Importing personal files from the separate, non-Git local `job-automate` directory into the canonical public repository.
- Adding a new browser service or running the OpenCode `browse` MCP as a second controller. The repo standard is the existing Microsoft Playwright MCP configured with the extension.

## Constraints and safety

- One existing authenticated Chrome profile, attached through the Playwright extension; no remote-debugging-port setup and no `connectOverCDP` in active repository code.
- MCP workflow files are trusted local repository code. `browser_run_code_unsafe` is RCE-equivalent; never pass page-provided or third-party code to it.
- Browser workflows may inspect fields and click only Next/Continue/Review controls after required fields are complete and valid. They must never click a final Submit/Apply/Send control.
- Form inspection may return labels, types, choices, required/filled/invalid state, and validation messages, but must not return entered field values.
- User profile files, resume PDFs, application state, and logs remain ignored/local. Sensitive or uncertain eligibility, legal, compensation, and demographic questions require user judgment.
- Public `main` currently contains personally identifying application values in source. Remove those from the current tree, but do not rewrite history without separate approval.
- The original local directory has no `.git` and contains local-only work. Build from the canonical public clone and leave the original directory untouched.

## Approaches considered

1. **OpenCode `browse` MCP:** offers session allowlists and handoffs in this agent environment, but it is not listed in the user's OpenCode config and cannot be assumed available to repository users.
2. **Microsoft `@playwright/mcp` extension (chosen):** already configured by the user, attaches to their intended Chrome profile, and supports repository workflow files through `browser_run_code_unsafe`'s filename option. Its unsafe code capability requires strict source-trust and submission-gate rules.
3. **Keep Node Playwright/CDP scripts:** rejected as the primary path because they need a separate CDP endpoint and do not operate as OpenCode MCP workflows.

## Design

- `AGENTS.md` gives OpenCode a concise operating policy: read the MCP workflow files, use the configured Playwright MCP, keep AI in the judgment loop, and stop for review before final submission.
- `automation/profile.example.json` contains empty placeholders only. Users create ignored `automation/profile.local.json` for their own data; no actual account values are committed.
- `automation/mcp/collect-linkedin-jobs.js` returns a bounded, deduplicated list of visible LinkedIn job cards.
- `automation/mcp/prepare-application.js` returns a privacy-minimized form inventory, stops on CAPTCHA, validation errors, missing required answers, or final-submit controls, and advances at most one safe step per call.
- `automation/mcp/read-whatsapp-channel.js` reads messages and URLs from the already-open WhatsApp channel without navigating to arbitrary links or writing exports.
- Replace the Node/CDP application entrypoints with these MCP workflows; update README usage and remove the now-unused direct Playwright dependency. Retain job URL files, license, and ignored state-file patterns.
- Use Node's built-in test runner; no new test dependency is needed.

## Calls left to the implementer

- Keep workflow files self-contained function expressions because the MCP filename runner invokes one file at a time.
- Bound collection output (40 job cards, 100 WhatsApp messages) to control context and avoid accidental bulk reading.
- Leave existing public history intact and report that prior PII may remain reachable there.
