# Job Automation Tools

A collection of browser-automation scripts that apply to remote jobs on your behalf using
**Chrome DevTools Protocol (CDP) + Playwright**, attaching to an already-authenticated Chrome
instance. Built for a Java Full Stack / React engineer, but configurable for any profile.

> **Legal / Ethical Use:** This tool is provided for personal, authorized use on your own accounts.
> You are responsible for complying with each platform's Terms of Service. Use responsibly and do
> not spam. The authors are not responsible for misuse or account actions taken by platforms.

---

## How it works

1. You launch Google Chrome with `--remote-debugging-port=9222` using a dedicated user-data-dir.
2. You log in manually to the target platforms (LinkedIn, Wellfound, …) once. Cookies persist.
3. The scripts connect to that Chrome via Playwright's `chromium.connectOverCDP`.
4. They search jobs, open each posting, drive the multi-step application form, fill fields from
   your resume, and submit — verifying submission actually succeeded before marking it done.
5. Progress is tracked in per-platform `applied.json` files so runs are resumable and idempotent.

Supported platforms:
- **LinkedIn** — Easy Apply (multi-step, resume selection, screening questions)
- **Wellfound** (AngelList) — Apply on Wellfound (modal with custom questions)

---

## Prerequisites

- macOS (tested on Darwin) with Google Chrome at `/Applications/Google Chrome.app`
- Node.js 18+
- A dedicated Chrome debug profile (see Setup)

## Setup

### 1. Launch Chrome with remote debugging

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.chrome-automation-profile"
```

Verify: `curl http://127.0.0.1:9222/json/version`

### 2. Log in manually

In that Chrome window, sign in to LinkedIn and Wellfound with your account. Cookies persist in
`~/.chrome-automation-profile`.

### 3. Install dependencies

```bash
cd job-automation-tools
npm install playwright
```

(Or symlink `node_modules` to an existing Playwright install.)

### 4. Add your resume

Place your resume PDF as `AryanBatraResume.pdf` in the project root (or update `RESUME_PATH` in
the scripts). The LinkedIn script uploads this file on the resume step.

### 5. Configure your profile

Edit the constants in each platform script:
- `KEYWORDS` / `SEARCH_URL` — what to search
- `MAX_APPS` — cap per run (env var also supported)
- Skill/years mapping in `linkedin/linkedin-apply.cjs` (`SKILL_YEARS`) — answer honestly

## Usage

### LinkedIn

```bash
cd linkedin
MAX_APPS=20 KEYWORDS="remote java,remote react,remote intern" node linkedin-apply.cjs
```

What it does:
- Searches LinkedIn Jobs with the given keywords (remote filter `f_WT=2`, Easy Apply `f_AL=true`).
- Collects job view URLs.
- For each job: opens it, clicks **Easy Apply**, walks every step (contact info → resume →
  screening questions → review → submit), filling fields from your profile.
- Answers "years of experience with X" questions from a skill→years map (unknown skills → 0).
- Verifies submission succeeded before marking the job as applied.
- Tracks state in `linkedin/applied.json` (resumable).

### Wellfound

```bash
cd wellfound
MAX_APPS=20 node wellfound-apply.cjs
```

Optional: `SEARCH_URL="https://wellfound.com/jobs?locations[]=India&remote=true&role=..."`.

What it does:
- Loads the Wellfound search, scrolls to collect job URLs.
- For each job: opens detail, clicks **Apply**, fills the custom question textarea(s) and any
  text inputs, clicks **Send application**.
- Verifies the modal closed and the Apply button disappeared before marking applied.
- Tracks state in `wellfound/applied.json`.

### Environment variables

| Var | Description |
|---|---|
| `CDP_ENDPOINT` | Chrome debug URL (default `http://127.0.0.1:9222`) |
| `MAX_APPS` | Max applications per run |
| `KEYWORDS` | Comma-separated search keywords (LinkedIn only) |
| `SEARCH_URL` | Wellfound search URL (Wellfound only) |

## Project structure

```
job-automation-tools/
├── linkedin/
│   └── linkedin-apply.cjs     # LinkedIn Easy Apply automation
├── wellfound/
│   └── wellfound-apply.cjs    # Wellfound Apply automation
├── AryanBatraResume.pdf       # your resume (not committed)
├── package.json
└── README.md
```

## Notes & caveats

- LinkedIn and Wellfound change their DOM frequently. Selectors are based on observed markup;
  if a run stops working, inspect the page and update the selectors.
- Screening questions vary per job. The scripts answer common ones heuristically; review
  `questions.log` (LinkedIn) to see what was asked and refine answers.
- Applications use your saved profile resume on Wellfound (no file upload in that flow) — make
  sure your profile is complete.
- Be mindful of rate limits and platform ToS. Cap `MAX_APPS` per day.

## License

MIT
