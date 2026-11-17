# LinkedIn application engine

A numbered pipeline that applies to LinkedIn Easy Apply jobs. The machine does
the repetitive work; the user's confirmed data decides what can be filled.

Read `../docs/engine-spec.md` for the full contract and guardrails.

## Modules

| file | responsibility | failure it prevents |
| --- | --- | --- |
| `00-context.js` | shared helpers, installed into the page after every navigation | helpers that silently break on a page change |
| `01-preflight.js` | profile, preferences and answers gate | applying with incomplete data |
| `02-search.js` | build the search URL from preferences, apply Easy Apply and Remote filters | searching the wrong thing |
| `03-collect.js` | read the job cards | losing a card because the markup changed |
| `04-select.js` | apply target and exclusion rules | applying to excluded titles or companies |
| `05-open.js` | open the job, open the apply surface, reject external ATS forms | filling a Workable or Lever form by accident |
| `06-inspect.js` | inventory every visible control | missing a required question |
| `07-fill.js` | fill known answers, collect gaps | guessing an unknown field |
| `08-advance.js` | click Next only when nothing is missing, read validation errors | advancing past an unanswered question |
| `09-submit.js` | click the final control exactly once | double submission, ambiguous targets |
| `10-verify.js` | prove the submission happened | reporting a job as applied when it was not |
| `engine.js` | the orchestrator | — |
| `build.js` | bundles the modules into `dist/linkedin-apply.js` | running a stale bundle |

## Run

```sh
node linkedin/automation/build.js
```

```js
await page.evaluate((config) => { window.__JAT__ = config; }, { preferences, answers, preflight });
await tools.playwright.browser_run_code_unsafe({ filename: 'linkedin/automation/dist/linkedin-apply.js' });
```

`preferences` is `linkedin/content/local/preferences.json`.
`answers` is built with `python3 linkedin/automation/scripts/build-answers.py`.
`preflight` is the output of `python3 linkedin/automation/scripts/profile_store.py preflight`.

## Extending it

- **A new question appeared.** Add the answer to `profile.json` or the answer bank, then rebuild the answers file. Never patch a module for one field.
- **A new kind of control appeared** (a combobox, a date picker). Extend `07-fill.js` and `06-inspect.js` for that control type, and add a case to `tests/browser/linkedin-engine.browser.test.cjs`.
- **A new site.** Do not extend this folder. Add a parallel engine and keep `companies/generic/` for one-off generic forms.

## Tests

```sh
npm test                      # unit tests for the gate, selection and search URL
npm run test:browser          # end to end engine tests against synthetic pages
```

The browser tests cover the guardrails: a required field without an answer
blocks the submission, a blocked preflight stops the run, and a submission is
only reported as applied when the page shows it.
