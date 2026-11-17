# Job Application Automation — Operating Prompt

This is the spec for the automation machine in `linkedin/automation/`. Read it before running or changing anything.

## 1. What the machine does

For a chosen search, the machine opens every matching job, fills every field it can answer from the user's confirmed data, advances the form, submits, **verifies** the submission actually happened, and records the result locally. The AI only steps in when the machine reports a gap.

The machine is not allowed to guess. Anything not derivable from `profile.json` / `preferences.json` / the answer bank is a **gap**, and a gap stops that one application. It never blocks the whole run.

## 2. Two JSON files drive everything

| file | holds | who edits it |
|---|---|---|
| `linkedin/content/local/profile.json` | who the user is: contact, work history, skills, preferences, sensitive answers | the user, confirmed with the AI |
| `linkedin/content/local/preferences.json` | how the machine should behave: search parameters, target titles, exclusions, answer policy, limits | the user |

Static content and choices live in JSON only. No values are hardcoded in the automation scripts.

**Hard gate.** Before any application runs, `linkedin/automation/scripts/profile_store.py preflight` must report `{"status":"ready"}`. A blocked preflight (missing field, unanswered sensitive category, unreadable answer bank, invalid site policy, missing preferences) stops the run with a clear error naming the missing paths. The engine re-checks the gate at runtime and refuses to apply if it is not ready.

## 3. Search parameters come from the user

`preferences.json` holds the search: keywords, location, remote-only, easy-apply-only, how recent a posting must be, how many pages to walk, and how many applications to make per run. Changing the search means editing JSON, never editing code.

`search.datePosted` accepts `1h`, `24h`, `7d`, `30d` or `any` (default). It becomes LinkedIn's `f_TPR` filter, so only postings inside that window are collected.

```json
{
  "search": { "keywords": "remote java full stack engineer", "location": "India", "remoteOnly": true, "easyApplyOnly": true, "datePosted": "24h", "maxPages": 4, "maxApplications": 25 },
  "targets": { "includeTitles": [], "excludeTitles": [], "excludeCompanies": [], "excludeWords": ["senior", "staff", "principal", "manager", "head of"] },
  "answers": { "resumeFile": "", "autoFillUnknown": false },
  "policy": { "requireVerifiedSubmission": true, "stopOnChallenge": true, "fieldTimeoutSeconds": 30 },
  "logging": { "markdownFile": "linkedin/content/local/applications.md" }
}
```

## 4. Field handling

1. The engine inventories every visible control: label, type, options, required, filled.
2. A control is answered only from the confirmed profile, the answer bank, or the preferences.
3. If a required control has no confirmed answer, the engine does **not** click Next and does **not** submit. It records the gap and moves to the next job.
4. If a control is not answered within the field timeout (`policy.fieldTimeoutSeconds`, default 30), the engine treats it as a gap, records it, and stops that application. The gap is written to `linkedin/content/local/field-gaps.json` so the next fix is a permanent fix: add the answer to the profile/answer bank, never a one-off patch in the script.
5. Unsupported controls (iframes, file pickers, custom widgets) are gaps too.

## 5. Submission guardrails

This is the part that must never lie.

- The engine clicks the final control **once**, only when every required field is filled and no gap remains.
- After clicking, it verifies with independent signals: the page reports an application status (`Application submitted`, `Application sent`), or the Apply control is gone and the job shows an applied state.
- If verification fails, the result is `submission_unverified`. The engine **never** retries and never records the job as applied.
- A `needs_answers` result is never treated as done. A skipped job is never recorded as applied.

## 6. What the machine writes

- `linkedin/content/local/applications.md` — user-facing markdown log: date, job title, company, location, result, and the reason when something was skipped.
- `linkedin/content/local/applications.json` — the same records for the machine.
- `linkedin/content/local/field-gaps.json` — fields that could not be answered, so the next run can cover them.

## 7. Module map

`linkedin/automation/` is a numbered pipeline. Each file is one responsibility.

| file | responsibility |
|---|---|
| `00-context.js` | shared helpers, installed into the page once per navigation |
| `01-preflight.js` | profile/preferences/answers gate |
| `02-search.js` | build the search URL from preferences, apply filters |
| `03-collect.js` | read the job cards from the results list |
| `04-select.js` | apply target/exclusion rules to the cards |
| `05-open.js` | open the job, open the apply surface, reject external ATS forms |
| `06-inspect.js` | inventory every visible control |
| `07-fill.js` | fill known answers, collect gaps |
| `08-advance.js` | click Next only when nothing is missing, read validation errors |
| `09-submit.js` | click the final control exactly once |
| `10-verify.js` | prove the submission happened |
| `engine.js` | the orchestrator that runs the sequence |
| `build.js` | bundles the modules into `dist/linkedin-apply.js` for the MCP |

Build before running:

```bash
node linkedin/automation/build.js
```

Run (Playwright MCP, `browser_run_code_unsafe`):

```js
await tools.playwright.browser_run_code_unsafe({ filename: 'linkedin/automation/dist/linkedin-apply.js' })
```

Configuration reaches the engine through the page, injected before the run:

```js
window.__JAT__ = { preferences, answers, preflight }
```

## 8. Rules that never change

- Never solve, bypass, or retry a challenge. Stop and let the person handle it.
- Never submit a form with a missing required answer.
- Never claim a submission without the verification signal.
- Never hardcode a personal value into a script. JSON only.
- Never patch the script for one job's field. Add the answer to the data; extend the module only when the field type itself is new.
