// 09-submit.js
// Clicks the final control exactly once. Ambiguity or a missing control stops
// the run; the control is never clicked twice.

const submitApplication = async (page) => {
  return page.evaluate(async ({ finalSource }) => {
    const helpers = window.__JAT_HELPERS__;
    if (!helpers) return { status: 'no_submit_control', clicked: false };
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const scope = helpers.applyScope();
    if (!scope) return { status: 'no_submit_control', clicked: false };

    const candidates = helpers.textControls(new RegExp(finalSource, 'i'), scope);
    if (candidates.length === 0) return { status: 'no_submit_control', clicked: false };
    if (candidates.length > 1) {
      return {
        status: 'ambiguous_submit_control',
        clicked: false,
        candidates: candidates.map((node) => (node.innerText || '').trim()),
      };
    }

    const submit = helpers.formButton(scope, new RegExp(finalSource, 'i'));
    if (!submit) return { status: 'no_submit_control', clicked: false };

    submit.click();
    await wait(1800);
    return { status: 'clicked', clicked: true };
  }, { finalSource: FINAL_CONTROL_PATTERN.source });
};

if (typeof module === 'object' && module.exports) {
  module.exports = { submitApplication };
}
