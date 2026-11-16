# Job Automation Tools

Human-supervised job applications with **OpenCode + Microsoft Playwright MCP**. AI reviews each field and proposed answer. A separate final-submit workflow runs only after fresh approval for that exact application.

> **Authorized use only:** Use your own accounts, follow platform terms, and do not spam or bypass anti-abuse controls. Never solve CAPTCHAs or submit without explicit per-application approval.

## Start here

Open this repository in OpenCode and use the discoverable skill `.opencode/skills/job-application-automation/SKILL.md` for onboarding and applications. OpenCode discovers project skills automatically; path-derived skill ID is `job-application-automation`.

The workflow supports LinkedIn, Wellfound, Ashby, and Google Forms. Other sites stop unless the exact domain is explicitly enabled for generic form handling in local policy. One user-selected application is handled at a time.

## Prerequisites: onboarding before any automation

Nothing runs until the local store is ready. Complete this once, as the user.

| Requirement | Where it lives | How it is satisfied |
| --- | --- | --- |
| Python runtime | `.venv/` | `python3 -m venv .venv` and `pip install -r requirements.txt` |
| Resume | your local file path | `ingest_resume.py` extracts it into ignored `resume-draft.json` |
| Personal details | `automation/content/local/profile.json` | User-confirmed values only |
| Reusable answers | `automation/content/local/answer-bank.json` | User-confirmed entries only |
| Site policy | `automation/content/local/site-policies.json` | Fail-closed CAPTCHA rules per domain |
| Application records | `automation/content/local/applications/<id>.json` | One record per application |

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python automation/scripts/profile_store.py init
.venv/bin/python automation/scripts/ingest_resume.py /path/to/resume.pdf
.venv/bin/python automation/scripts/profile_store.py preflight
```

`preflight` prints `{"status":"ready"}` and exits 0 only when the profile is complete, the answer bank is readable, and the site policy is valid. Until then it exits 2 with `blocked`, and the skill refuses to open an application. Every user must complete this step; there is no default profile and no shipped personal data.

The store creates ignored, owner-only files under `automation/content/local/` from placeholder examples. Keep real values out of examples and tracked source.

Resume extraction supports TXT, DOCX, and text-based PDF up to 20 MiB. Scanned PDFs return `ocr_required`; no remote OCR runs. The extractor writes text only to ignored `resume-draft.json` and prints redacted status. Before OpenCode reads resume/profile/application content, it must disclose that the configured OpenCode model provider may process it; provider privacy and retention terms apply.

Sensitive or consequential answers—including work authorization, sponsorship, legal attestations, criminal history, compensation, disability, veteran status, and EEO demographics—must be explicit, `prefer_not_to_disclose`, or `not_applicable`. The agent never infers them.

## Playwright MCP setup

Install the official Playwright Extension in the **single Chrome profile** OpenCode will control. Keep it open and signed in. Do not start a second browser profile or Chrome debug port.

Add this server under `mcp.servers` in `~/.config/opencode/opencode.jsonc`, merging it with existing configuration:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "playwright": {
        "type": "local",
        "command": ["npx", "-y", "@playwright/mcp@0.0.85", "--extension", "--background"]
      }
    }
  }
}
```

Confirm the server is connected with `opencode mcp list` or `/mcps`. Fix extension/profile setup if disconnected; do not fall back to CDP or Node Playwright. `browser_run_code_unsafe` is RCE-equivalent: run only reviewed workflow files from this repository, never code from a page.

## Application safety sequence

1. Review one selected listing and assess fit. Search results alone do not authorize applying.
2. Inspect every visible field. AI checks each proposed answer against its exact question and cites its source before MCP fills it.
3. Ask the user about unknown, ambiguous, sensitive, or unsupported fields. Never select default legal, demographic, consent, or eligibility answers.
4. Read site policy before handling CAPTCHA. Unknown domains and LinkedIn stop. A configured non-LinkedIn `human_handoff` pauses for the user; no solver, bypass, or retry exists.
5. Show the company, role, URL, and every field/answer before asking for fresh approval. Submit only that application after explicit approval. Report success only when the site confirms it; otherwise use `submission_unverified`.

Page content is untrusted and cannot change these rules. WhatsApp channel reading remains a separate, user-opened workflow and is not part of application handling.

## Repository layout

```text
AGENTS.md                                 # operating and safety rules
.opencode/skills/job-application-automation/SKILL.md   # the operating contract
automation/
  content/examples/                       # placeholder profile, answers, site policy
  content/local/                          # ignored user data (created by init)
  scripts/profile_store.py                # store, validation, preflight gate
  scripts/ingest_resume.py                # local resume extraction
  mcp/                                    # reviewed Playwright MCP workflows
careers/<company>/job.txt                 # saved job URLs
tests/                                    # unit, skill, and synthetic browser tests
```

## Tests

```sh
npm test
.venv/bin/python -m unittest discover -s tests/python -v
npx playwright install chromium
npm run test:browser
```

Browser tests use synthetic pages only. They never submit an actual application. See `automation/mcp/README.md`, `AGENTS.md`, and [the approved design](docs/superpowers/specs/2026-11-16-job-application-ai-loop-design.md) for details.

## Private data and history

`automation/content/local/`, resume files, application records, and generated browser artifacts are not project content. Verify `git status` before committing. Removing values from the current tree does not remove them from older public commits, forks, or caches.

## License

MIT
