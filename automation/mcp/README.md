# Playwright MCP workflows

These files are JavaScript function expressions for the Microsoft Playwright MCP `browser_run_code_unsafe` tool's `filename` input. Paths are relative to the OpenCode workspace root. Run only these reviewed repository files; the MCP code tool is RCE-equivalent.

## Application workflows

- `collect-linkedin-jobs.js`: on a LinkedIn jobs search page, return up to 40 distinct visible job cards with title, company, location, URL, and whether the card is selected. Handles both anchor-backed and current button-backed cards.
- `inspect-application.js`: inventory every visible form control. Reports label, type, target, required/invalid/filled state, and option labels. Never returns a field value. Reports unlabeled required fields, iframes, custom widgets, and file inputs as unsupported.
- `start-application.js`: open the Apply/Easy Apply entry point for a selected LinkedIn, Wellfound, Ashby, or Google Forms job. Rejects lookalike hosts, malformed URLs, and unknown domains. Never clicks a final application control.
- `prepare-application.js`: check the current form without returning entered values. Stops on a challenge, a final Submit/Apply/Send control, missing or invalid required fields, and unsupported controls. Never clicks a progression control; a wizard step returns `manual_step` until a site-specific adapter is verified.
- `submit-application.js`: click exactly one visible, unambiguous final application control and verify the site's success marker. Ambiguous targets, challenges, and missing success markers stop without a retry.

## Other workflows

- `read-whatsapp-channel.js`: on an already-open WhatsApp Web channel, return up to 100 distinct visible messages and their links. It does not navigate or write files.

## Order of use

1. `collect-linkedin-jobs.js` — choose one job.
2. `start-application.js` — open the application.
3. `inspect-application.js` — list fields and unsupported controls.
4. Fill approved answers with normal MCP fill actions.
5. `prepare-application.js` — validate the step, advance only where verified.
6. `submit-application.js` — only after the user approves this exact application.

The agent matches verified user data to fields, asks about uncertain answers, and obtains explicit approval before final submission. No workflow infers an answer, solves a challenge, or fills a field.
