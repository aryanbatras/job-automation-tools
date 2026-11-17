// 08-advance.js
// Guardrails: Next is clicked only when every required control is answered,
// only inside the apply surface, and only when the step really moves
// forward. A validation error is a gap, never a success.

const advanceStep = async (page) => {
  return page.evaluate(async ({ nextSource }) => {
    const helpers = window.__JAT_HELPERS__;
    if (!helpers) return { status: 'apply_surface_lost' };
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    let scope = helpers.applyScope();
    if (!scope) return { status: 'apply_surface_lost' };

    // Let the step settle before touching its footer: LinkedIn re-renders the
    // controls after the fill pass and a click against the old node is lost.
    await wait(400);
    scope = helpers.applyScope() || scope;

    const unanswered = (root) =>
      helpers
        .unansweredControls(root)
        .filter((control) => control.required)
        .map((control) => control.label)
        .filter(Boolean);

    const missing = unanswered(scope);
    if (missing.length > 0) return { status: 'needs_answers', missing };

    // The last step of the form offers the submit control.
    const submit = helpers.formButton(scope, /^(submit application|submit|send application)$/i);
    if (submit) return { status: 'submit_ready' };

    // LinkedIn re-renders the footer while it auto-fills the first step, so
    // the control can be absent for a moment. Wait for it before giving up.
    let next = helpers.formButton(scope, new RegExp(nextSource, 'i'));
    for (let tick = 0; tick < 10 && !next; tick += 1) {
      await wait(250);
      scope = helpers.applyScope() || scope;
      next = helpers.formButton(scope, new RegExp(nextSource, 'i'));
    }
    if (!next) {
      const disabled = helpers.formButton(scope, new RegExp(nextSource, 'i'), true);
      return {
        status: disabled ? 'needs_answers' : 'no_next_control',
        missing: disabled ? unanswered(scope) : [],
      };
    }

    const progressOf = (root) => {
      const match = (root.innerText || '').match(/\b(\d+)\s*\/\s*(\d+)\s*(?:pages?|steps?)?/i);
      return match ? `${match[1]}/${match[2]}` : '';
    };
    const beforeText = (scope.innerText || '').replace(/\s+/g, ' ');
    const beforeProgress = progressOf(scope);
    const signatureOf = (root) =>
      `${progressOf(root)}|${helpers.controlsIn(root).length}|${(root.innerText || '').replace(/\s+/g, ' ').length}`;
    const beforeSignature = signatureOf(scope);

    next.click();

    // The next step paints after the click, not on it. Wait until the surface
    // changes and then holds still: a fill or a second click against the old
    // step is how a form silently loses every answer.
    const controlReady = (root) =>
      Boolean(
        helpers.formButton(root, /^(submit application|submit|send application)$/i) ||
          helpers.formButton(root, new RegExp(nextSource, 'i')),
      );
    let after = helpers.applyScope() || scope;
    let previous = beforeSignature;
    let still = 0;
    for (let tick = 0; tick < 30; tick += 1) {
      await wait(150);
      after = helpers.applyScope() || after;
      const current = signatureOf(after);
      still = current !== beforeSignature && current === previous ? still + 1 : 0;
      previous = current;
      // The clicked control can disappear before the step it opens paints:
      // a changed surface with no control at all is still a step in transit.
      if (still >= 2 && controlReady(after)) break;
    }

    const errors = helpers.validationErrors(after);
    if (errors.length > 0) {
      const broken = helpers
        .controlsWithErrors(after)
        .map((control) => control.label)
        .filter(Boolean);
      return { status: 'validation_error', errors, missing: broken };
    }

    const afterText = (after.innerText || '').replace(/\s+/g, ' ');
    const afterProgress = progressOf(after);
    const moved = afterText !== beforeText || afterProgress !== beforeProgress;

    // A step that moved is the next step, even when its own required controls
    // are still empty: filling them is the next loop's job. Only a step that
    // stayed put and still has empty required controls rejected the click.
    const stillMissing = unanswered(after);
    if (!moved && stillMissing.length > 0) {
      return { status: 'needs_answers', missing: stillMissing };
    }

    return {
      status: 'advanced',
      moved,
      keys: helpers.controlsIn(after).length,
      progress: afterProgress,
      detail: {
        beforeProgress,
        afterProgress,
        beforeLength: beforeText.length,
        afterLength: afterText.length,
      },
    };
  }, { nextSource: PROGRESSION_CONTROL_PATTERN.source });
};

if (typeof module === 'object' && module.exports) {
  module.exports = { advanceStep };
}
