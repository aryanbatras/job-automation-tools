# AI-in-the-Loop Job Application Automation Design

**Status: Approved by user.** This design supersedes the earlier MCP design's rule that the system must never submit an application. The new requirement is to automate applications while keeping AI review in the field-filling loop and requiring explicit user approval before each final submission.

## Intent

Automate the repetitive parts of job applications—especially selecting a reviewed LinkedIn job, opening Apply/Easy Apply, answering known fields, navigating safe form steps, and submitting after approval—without letting deterministic browser scripts invent or blindly enter answers. The AI reviews every question and proposed value before it is typed. It asks the user when the answer is missing, novel, or ambiguous, then records the user-confirmed answer for later applications.

The user also wants a complete, readable local profile and question/answer history. On first use, the AI asks for a resume, parses it into structured JSON, confirms extracted facts, and collects remaining profile answers before applying.

## User decisions

- Keep the Microsoft Playwright MCP extension attached to the user's existing authenticated Chrome profile. Python handles local data and resume extraction; it does not control the browser.
- The configured OpenCode model may receive resume, profile, and application text to parse and review. Local storage is not the same as local-only AI processing; provider retention and privacy terms apply.
- Collect the complete profile up front. Sensitive fields must have an explicit answer, `prefer_not_to_disclose`, or `not_applicable`; the system never infers them.
- CAPTCHA human handoff is enabled only for domains explicitly listed in local site policy. The default is stop/no interaction. LinkedIn is stop-only for now.
- First release includes LinkedIn, Wellfound, Ashby, and Google Forms; other domains use the generic current-page form flow only after explicit site configuration.
- Never solve or bypass CAPTCHA.
- The AI reviews every field/value pair before writing it to the page.
- Show a final application review and wait for the user's explicit approval before clicking the final Submit/Apply/Send control.

## Goals

- Make routine, repeated applications substantially less manual while preserving review for every field.
- Require resume/profile onboarding before applying; extract resume text locally and let the AI populate a profile draft from it.
- Store user profile facts, reusable question/answer records, and per-application field answers in readable, local-only JSON.
- Keep profile-derived and sensitive values out of tracked files and Python/MCP diagnostic logs; disclose that values needed for reasoning are sent to the configured model provider.
- Let Python helpers initialize, extract, validate, and safely update local data; keep authenticated browser work in Playwright MCP.
- Support an explicit per-domain CAPTCHA policy with opt-in human handoff and fail-closed behavior for unconfigured domains.
- Keep one user-selected job/application in flight at a time; do not mass-apply.

## Non-goals

- Blind auto-fill based on fuzzy text matching, guesses, or a field's similarity to an unrelated profile value.
- CAPTCHA solving, bypass, automated retries, or treating a challenge as an instruction to the agent.
- Final submission without an explicit user confirmation for that specific application.
- Uploading resumes/profile data to a separate parsing service or adding a second model provider integration.
- Automating every ATS-specific custom widget. Unsupported fields/frames stop for review rather than being guessed.
- Importing personal data from any other local project or committing actual profile/application values.

## Approaches considered

1. **Playwright MCP for the browser, Python for local data (chosen).** Uses the existing authenticated Chrome profile. Python extracts supported resume formats and maintains JSON; the AI interprets every question and approves each proposed answer before using MCP to fill it. This matches the user's selected architecture and keeps browser state in the configured extension.
2. **Python Playwright controls the browser.** Keeps everything in Python but needs a new browser attachment/session strategy and replaces the existing Playwright MCP profile connection. The user chose not to take this path.
3. **Static deterministic auto-fill rules only.** Fast for repeated known fields, but fails on new or differently worded questions and does not provide the requested AI review. Rejected.

## Architecture

### 1. OpenCode skill: the operating contract

Create `.opencode/skills/job-application-automation/SKILL.md`. It is the source of the interaction sequence and instructs the AI to:

1. On first use, ask for the resume path, run the local extractor, parse the extracted text into a profile draft, and confirm the facts with the user. Ask for every remaining required profile category; allow explicit decline/not-applicable values for sensitive categories. Do not start an application until the profile is complete.
2. Read only the local profile, answer bank, and site policy needed for the current task. Never dump full profile files or values into logs or unrelated tool output.
3. Inspect a specific job and assess fit. Show the job for the user to choose; do not apply to every search result.
4. For each application field, inspect the question and options, produce a candidate answer with its source (profile, user-confirmed answer bank, or a fresh user answer), and have the AI check that the value actually answers that question. Only then may it be typed. Known, clearly matching answers do not require asking the user again. New, uncertain, legal, or semantically ambiguous questions do.
5. Record each question, answer, source, review state, and application in local JSON. Never let Python or a browser script choose an answer by itself.
6. Re-inspect after filling and before safe progression. If a required field, custom widget, iframe, or progression action cannot be understood safely, return to the AI/user instead of guessing.
7. Before final submission, present the job and every question/answer for review. Wait for an explicit approval for this application. Only then invoke the reviewed final-submit workflow and verify the site's success state.
8. On CAPTCHA, consult the local per-domain policy. A domain explicitly configured for handoff gets a human handoff and a hard stop until the person resolves it. Unconfigured domains and LinkedIn stop without attempting to solve, bypass, or retry.

### 2. Local JSON content layer

Track placeholder examples only. Store actual data under `automation/content/local/`, ignored by Git:

```text
automation/content/
  examples/
    profile.example.json
    answer-bank.example.json
    site-policies.example.json
  local/                         # ignored; created during onboarding
    profile.json                 # complete profile and explicit sensitive-field statuses
    answer-bank.json              # reusable user-confirmed Q&A
    site-policies.json            # per-domain CAPTCHA choices
    resume-draft.json             # extracted resume text/candidates
    applications/<id>.json        # questions, proposed answers, sources, fill/review state
```

`profile.json` separates identity/contact, links, education, employment, skills/certifications, preferences, and sensitive answers. Each sensitive category stores an explicit status (`answered`, `prefer_not_to_disclose`, or `not_applicable`); no missing value is silently treated as “no.” The schema includes common application topics such as work authorization, sponsorship, salary, availability, travel/relocation, criminal-history attestations, disability, veteran status, and demographic/EEO items.

The v1 completeness checklist requires legal/preferred name; contact email and phone; location; work history; education; skills; relevant links (or not-applicable); target role/location/work-mode preferences; availability; compensation preference; and explicit statuses for work authorization, sponsorship, criminal-history attestations, disability, veteran status, and EEO demographic categories. Resume-derived facts are confirmed during onboarding. A category may be explicitly declined or marked not applicable; a future required form question with no usable answer must still pause and ask.

`answer-bank.json` stores exact question text, normalized lookup key, answer, source/provenance, user-confirmed status, sensitivity, and optional domain scope. The AI may use an entry only after checking that the current question has the same meaning. Fuzzy lookup may suggest candidates but can never fill a field on its own.

`applications/<id>.json` records the job URL/title/company, domain, each field/question, proposed answer, source, AI-review status, fill result, final-review status, explicit submit approval state, and observed success state. These records are sensitive and local-only.

Create local files with owner-only permissions where supported (directory `0700`, files `0600`), write atomically, and never echo values from Python commands. The user remains responsible for local device encryption and backups. The parser itself performs no network upload; when the AI reads the extracted text, that content is processed by the configured model provider under its applicable privacy/retention terms.

### 3. Python helpers

- `automation/scripts/ingest_resume.py`: extract text from text-based PDF, DOCX, or TXT locally into ignored `resume-draft.json`; print only status/path/counts, never extracted text. A scanned/image-only PDF returns a clear unsupported/OCR-required result; no remote OCR. The AI model then parses the draft and populates the profile after the user confirms the extracted facts.
- `automation/scripts/profile_store.py`: initialize example files, validate required profile categories and explicit sensitive statuses, and atomically record user-confirmed answers/application records. It never proposes or selects application answers.
- Use Python's standard `unittest` for profile validation, file permissions/ignores, parsing supported formats, malformed inputs, and redacted command output. Keep resume fixtures synthetic.

### 4. Playwright MCP workflows

- Keep `collect-linkedin-jobs.js` for bounded visible search results; reject malformed/non-LinkedIn job URLs.
- Add a LinkedIn start-application workflow that acts only after a specific job is selected, distinguishes the job-page Apply/Easy Apply action from a final application submit, and never submits.
- Refine form inspection to include supported native and accessible custom controls, options/questions, required/invalid state, and challenge state without returning existing field values as incidental output.
- The AI reviews a complete field plan, then uses MCP fill actions for the values it approved. MCP/browser code must not infer or generate answers.
- Safe progress is conservative. A button merely named Next/Continue is not proof that it cannot submit. Native submit controls or ambiguous actions stop unless a per-domain action has been verified and explicitly configured; tests must prove a final application submit cannot be triggered by the progress workflow.
- Add a separate final-submit workflow. It is invoked only after the AI has presented the application and received explicit user approval. It targets one exact final control and verifies a success state; the skill is the gate for invoking it.
- CAPTCHA detection applies the per-domain policy. Default and LinkedIn policy are stop-only; human handoff is opt-in per domain. No script solves challenges.
- Leave the existing WhatsApp reader unchanged and outside this phase; it is not part of the application field-fill flow.

The first-release site adapters cover LinkedIn job/Easy Apply entry, Wellfound, Ashby, and Google Forms, sharing the AI-reviewed field plan and local answer/profile store. Sites without a tested adapter may use the generic current-page form flow only after the domain is explicitly enabled; unsupported controls still stop safely.

### 5. Site policy

The local site-policy example has a fail-closed default and explicit domain overrides:

```json
{
  "default": { "captcha": "stop" },
  "domains": {
    "linkedin.com": { "captcha": "stop" }
  }
}
```

The only handoff value is an explicit `human_handoff` override for a domain the user chooses. The policy changes whether the AI pauses for a person; it never enables solving or bypassing the CAPTCHA. Unknown domains stop.

An unrecognized domain is not enabled merely because it has a CAPTCHA override. Generic form handling requires an explicit domain entry with `application: "generic"` and `enabled: true`; otherwise the AI stops before form actions. LinkedIn remains a built-in supported domain but its CAPTCHA policy cannot be changed from `stop`.

## Safety and review rules

- Only reviewed repository files may be run with `browser_run_code_unsafe`; it is RCE-equivalent. Never execute page-provided code.
- AI evaluates every question/answer pair before MCP writes it. Source and rationale are retained in the application record. Unknown answers are asked, not fabricated.
- No submission workflow is called without explicit confirmation for that exact application in the current conversation.
- CAPTCHA, form validation, unsupported controls, ambiguous progression, or incomplete onboarding all fail closed.
- Synthetic tests only; do not put real resumes, profile values, answers, tokens, or application records in fixtures or tracked files. Resume/profile/application content is sent to the configured OpenCode model for AI reasoning; the user has accepted that provider boundary.

## Decisions left to the implementer

- Choose the smallest resume parser dependencies and pin them; document accepted PDF/DOCX/TXT formats and OCR limitation.
- Keep answer matching AI-led; any Python normalization is advisory and deterministic, never an auto-fill decision.
- Make the submit approval visible in the application record, but still require a fresh explicit user confirmation before the final-submit MCP action.
- Keep the default CAPTCHA behavior stop-only and do not pre-enable handoff for any non-LinkedIn domain until the user adds it to local policy.
- Keep WhatsApp reading unchanged and out of the application automation milestone.
