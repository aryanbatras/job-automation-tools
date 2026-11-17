// 10-verify.js
// Proves the submission happened. Without a signal the result is
// submission_unverified, and the job is never recorded as applied.

const verifySubmission = async (page, job) => {
  return page.evaluate(({ jobId }) => {
    const normalized = (document.body.innerText || '').replace(/\s+/g, ' ');

    const submittedSignal = /application\s+(submitted|sent|was sent|has been sent|has been submitted)/i.test(
      normalized,
    );
    const statusSignal = /application status\s*[:\-]?\s*(submitted|sent)/i.test(normalized);

    // The card of the job turns into an applied state.
    const card = jobId
      ? document.querySelector(`[role="button"][componentkey*="${jobId}"]`)
      : null;
    const cardApplied = card ? /\bapplied\b/i.test(card.innerText || '') : false;

    const painted = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const appliedSignal = Array.from(
      document.querySelectorAll('button, a, span, strong, label, div'),
    ).some((element) => painted(element) && (element.innerText || '').trim().toLowerCase() === 'applied');

    const verified = submittedSignal || statusSignal || cardApplied || appliedSignal;

    return {
      verified,
      signals: {
        submittedSignal,
        statusSignal,
        appliedSignal,
        cardApplied,
      },
    };
  }, { jobId: (job && job.id) || '' });
};

if (typeof module === 'object' && module.exports) {
  module.exports = { verifySubmission };
}
