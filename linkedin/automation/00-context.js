// 00-context.js
// Node-side context: install the config, read it back, name the controls.
// The page runtime itself lives in linkedin/automation/page/*.js and is
// composed into the bundle by build.js.

const installConfig = (page, config) =>
  page.evaluate((value) => {
    window.__JAT__ = value;
    return true;
  }, config);

const readConfig = (page) => page.evaluate(() => window.__JAT__ || null);

// Control patterns. "Review" is a forward step on LinkedIn, "Back" never is.
const FINAL_CONTROL_PATTERN = /^(submit application|submit|send application)$/i;
const PROGRESSION_CONTROL_PATTERN = /^(next|continue|review)$/i;
const FORM_CONTROL_PATTERN = /^(submit application|submit|send application|next|continue|review)$/i;

const CHALLENGE_SELECTOR =
  'iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i], iframe[src*="turnstile" i], [class*="captcha" i], [id*="captcha" i], [data-sitekey]';

const challengePresent = (page) => page.locator(CHALLENGE_SELECTOR).count().then((count) => count > 0);

if (typeof module === 'object' && module.exports) {
  module.exports = { installConfig, readConfig, challengePresent, FINAL_CONTROL_PATTERN, PROGRESSION_CONTROL_PATTERN, FORM_CONTROL_PATTERN };
}
