// 07-fill.js
// Fills every control that has a confirmed answer.
//
// The form logic lives in the shared helpers (00-context.js), so the engine
// and the page driver fill a form the same way. A required control without an
// answer becomes a gap: the engine records it and refuses to advance.

const fillFields = async (page) => {
  const form = await page.evaluate(async () => {
    const helpers = window.__JAT_HELPERS__;
    if (!helpers) return { filled: [], gaps: [], scopeFound: false };
    const scope = helpers.applyScope();
    if (!scope) return { filled: [], gaps: [], scopeFound: false };
    const result = await helpers.fillForm(scope);
    return {
      filled: result.filled || [],
      gaps: result.gaps || [],
      pairs: result.pairs || [],
      scopeFound: true,
    };
  });

  return {
    filled: form.filled || [],
    gaps: (form.gaps || []).map((gap) => ({
      label: gap.label,
      reason: gap.reason,
      type: gap.type,
      options: gap.options || [],
    })),
    pairs: form.pairs || [],
    scopeFound: Boolean(form.scopeFound),
    prefilled: [],
    unsupported: [],
  };
};

// Repairs the controls the page rejected when a step advanced. Only
// confirmed answers are used; a derived value is the same answer in a form
// the control accepts.
const repairRejected = async (page) =>
  page.evaluate(async () => {
    const helpers = window.__JAT_HELPERS__;
    if (!helpers) return { repaired: [], remaining: [] };
    const scope = helpers.applyScope();
    if (!scope) return { repaired: [], remaining: [] };
    const repaired = [];
    const remaining = [];
    const seen = new Set();
    for (const broken of helpers.controlsWithErrors(scope)) {
      const key = broken.id || broken.label;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const element = broken.id ? document.getElementById(broken.id) : null;
      if (!element || !element.isConnected) {
        remaining.push(broken.label || key);
        continue;
      }
      const label = helpers.labelText(element) || broken.label || '';
      const confirmed = helpers.answerFor([label], helpers.aliasesFor(label));
      const wanted = confirmed === null || confirmed === undefined ? element.value : confirmed;
      const fixed = await helpers.repairValue(element, String(wanted), { ignoreMessage: true });
      const error = helpers.controlError(element);
      if (fixed && !error.over && element.checkValidity()) repaired.push(`${label}: ${fixed}`);
      else remaining.push(label || key);
    }
    return { repaired, remaining };
  });

if (typeof module === 'object' && module.exports) {
  module.exports = { fillFields, repairRejected };
}
