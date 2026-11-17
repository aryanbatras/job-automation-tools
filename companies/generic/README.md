# Playwright MCP workflows for company career sites

These files are JavaScript function expressions for the Microsoft Playwright MCP `browser_run_code_unsafe` tool's `filename` input. Paths are relative to the OpenCode workspace root. Run only these reviewed repository files; the MCP code tool is RCE-equivalent.

LinkedIn Easy Apply uses the dedicated engine in `linkedin/automation/` instead of these generic workflows.

## Application workflows

- `inspect-application.js`: inventory every visible form control. Reports label, type, target, required/invalid/filled state, and option labels. Never returns a field value. Reports unlabeled required fields, iframes, custom widgets, and file inputs as unsupported.
- `start-application.js`: open the Apply/Easy Apply entry point for a selected Wellfound, Ashby, or Google Forms job. Rejects lookalike hosts, malformed URLs, and unknown domains. Never clicks a final application control.
- `prepare-application.js`: check the current form without returning entered values. Stops on a challenge, a final Submit/Apply/Send control, missing or invalid required fields, and unsupported controls. Never clicks a progression control; a wizard step returns `manual_step` until a site-specific adapter is verified.
- `submit-application.js`: click exactly one visible, unambiguous final application control and verify the site's success marker. Ambiguous targets, challenges, and missing success markers stop without a retry.

## Order of use

1. `start-application.js` — open the application.
2. `inspect-application.js` — list fields and unsupported controls.
3. Fill approved answers with normal MCP fill actions.
4. `prepare-application.js` — validate the step, advance only where verified.
5. `submit-application.js` — only after the user approves this exact application.

The agent matches verified user data to fields, asks about uncertain answers, and obtains explicit approval before final submission. No workflow infers an answer, solves a challenge, or fills a field.

WhatsApp channel reading is separate: `whatsapp/read-whatsapp-channel.js`.
