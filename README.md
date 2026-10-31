# Job Automation Tools

Browser automation that applies to remote jobs on your behalf, using **Chrome DevTools Protocol (CDP) + Playwright**,
attaching to an already-authenticated Chrome instance. Organized by platform/domain for reusability.

> **Legal / Ethical Use:** For personal, authorized use on your own accounts only. Comply with each platform's
> Terms of Service. Do not spam. Authors are not responsible for misuse or account actions.

---

## Structure

```
job-automation-tools/
├── linkedin/                  # LinkedIn Easy Apply automation
│   └── linkedin-apply.cjs
├── wellfound/                 # Wellfound (AngelList) Apply automation
│   └── wellfound-apply.cjs
├── careers/                   # Direct company career portals (ATS)
│   ├── ats/                   # Reusable ATS automation scripts
│   │   └── ashby-apply.cjs    # Ashby (jobs.ashbyhq.com)
│   │   # workday, smartrecruiters, recruitee, lever, greenhouse coming
│   ├── <company>/job.txt      # one folder per company, job.txt holds the apply URL
├── whatsapp/                  # Read job postings from WhatsApp channels
│   └── readchannel.cjs
├── googleforms/               # Google Forms applications
│   └── googleforms-apply.cjs
│   ├── realmalliance/job.txt
│   └── ...
├── AryanBatraResume.pdf       # your resume (not committed)
├── package.json
└── README.md
```

Each platform folder is self-contained: script + its own `applied.json` state file.

## Prerequisites

- macOS with Google Chrome at `/Applications/Google Chrome.app`
- Node.js 18+
- A dedicated Chrome debug profile

## Setup

### 1. Launch Chrome with remote debugging
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.chrome-automation-profile"
```
Verify: `curl http://127.0.0.1:9222/json/version`

### 2. Log in manually to LinkedIn, Wellfound, etc. (cookies persist).

### 3. Install dependencies
```bash
npm install   # or symlink node_modules to an existing Playwright install
```

### 4. Add your resume
Place your resume PDF as `AryanBatraResume.pdf` in the project root (or set `RESUME_PATH`).

## Usage

### LinkedIn
```bash
cd linkedin
MAX_APPS=20 KEYWORDS="remote java,remote react,remote intern" node linkedin-apply.cjs
```

### Wellfound
```bash
cd wellfound
MAX_APPS=20 node wellfound-apply.cjs
# optional: SEARCH_URL="https://wellfound.com/jobs?locations[]=India&remote=true"
```

### Career portals (Ashby)
```bash
cd careers/ats
JOB_URL="https://jobs.ashbyhq.com/<company>/<id>" node ashby-apply.cjs
```
Each company has a folder under `careers/` with a `job.txt` containing its apply URL.
Add more companies by creating a folder + `job.txt`, then run the matching ATS script.

### Google Forms
```bash
cd googleforms
FORM_URL="https://docs.google.com/forms/d/e/.../viewform" node googleforms-apply.cjs
```

## CAPTCHA strategy

Some platforms (Ashby, etc.) use reCAPTCHA Enterprise. Automated traffic may be challenged.
- By default, the scripts **skip** CAPTCHA jobs, record them in `applied.json` under `skipped`
  (tagged `[captcha]`), and continue with the next job.
- To solve manually: set `SOLVE_CAPTCHA=1` and the script will wait (up to 2 min) while you
  solve the challenge in the browser; then it submits automatically.
- At the end of a run, review `skipped` entries to know which jobs need manual CAPTCHA solving.

### WhatsApp channels (read job postings)
```bash
cd whatsapp
node readchannel.cjs "NexusHub valut"
node readchannel.cjs "Off Campus Zone"
```
Reads recent messages from a WhatsApp channel and extracts job links into `<channel>_links.txt`.

## Environment variables

| Var | Description |
|---|---|
| `CDP_ENDPOINT` | Chrome debug URL (default `http://127.0.0.1:9222`) |
| `MAX_APPS` | Max applications per run |
| `KEYWORDS` | Comma-separated search keywords (LinkedIn) |
| `SEARCH_URL` | Wellfound search URL |
| `JOB_URL` | Single job URL (career portals) |
| `RESUME_PATH` | Path to resume PDF |

## Notes

- LinkedIn/Wellfound/Ashby change their DOM frequently; update selectors if a run breaks.
- Screening questions vary per job. Review `questions.log` (LinkedIn) to refine answers.
- CAPTCHAs: the scripts detect them and wait for you to solve them manually in the browser.
- State is tracked in per-folder `applied.json` files (resumable, idempotent).

## License

MIT
