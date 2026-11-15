# Playwright MCP workflows

These files are JavaScript function expressions for the Microsoft Playwright MCP `browser_run_code_unsafe` tool's `filename` input. Paths are relative to the OpenCode workspace root. Run only these reviewed repository files; the MCP code tool is RCE-equivalent.

## Workflows

- `collect-linkedin-jobs.js`: on a LinkedIn jobs search page, return up to 40 distinct visible job cards with title, company, location, and URL.
- `prepare-application.js`: inspect the current form without returning entered values; stop on CAPTCHA, final Submit/Apply/Send buttons, missing or invalid required fields; click at most one safe Next/Continue/Review control.
- `read-whatsapp-channel.js`: on an already-open WhatsApp Web channel, return up to 100 distinct visible messages and their links. It does not navigate or write files.

Use the agent instructions in the repository's `AGENTS.md`. These workflows intentionally do not fill answers or submit applications: the AI must match verified user data to fields, ask about uncertain answers, and obtain explicit approval before final submission.
