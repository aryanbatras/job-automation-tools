// page/04-fill.js
// Form filling in repeated passes, so a re-render cannot lose a write.

Object.assign(helpers, {
      // The questions this step asked, with the value each control ended up
      // holding. The driver stores them, so the next run answers them alone.
      questionPairs(root) {
        const pairs = [];
        for (const element of helpers.formControls(root || document)) {
          const type = (element.type || element.tagName || '').toLowerCase();
          const label = helpers.labelText(element) || helpers.groupLabel(element);
          if (!label) continue;
          if (type === 'radio') {
            if (!element.checked) continue;
            pairs.push({ label, value: helpers.optionText(element) || element.value, type: 'radio' });
            continue;
          }
          if (type === 'checkbox') {
            if (helpers.subscriptionControl(label)) continue;
            pairs.push({ label, value: element.checked ? 'yes' : 'no', type: 'checkbox' });
            continue;
          }
          const value = String(element.value || '').trim();
          if (!value) continue;
          const confirmed = helpers.answerFor([label], helpers.aliasesFor(label));
          pairs.push({
            label,
            value,
            type,
            source: String(confirmed) === value ? 'confirmed' : 'derived',
          });
        }
        const unique = new Map();
        for (const pair of pairs) if (!unique.has(pair.label)) unique.set(pair.label, pair);
        return Array.from(unique.values());
      },
      // Fills every control of the step that has a confirmed answer and
      // reports the ones that still have none.
      async fillForm(scope) {
        const root = scope || document;
        const filled = [];
        const gaps = [];
        const seen = new Set();
        // LinkedIn re-renders the step after a write, so the elements of one
        // pass go stale and their writes are lost. Repeat until a pass fills
        // nothing new; an already answered control is a read, not a write.
        for (let pass = 0; pass < 3; pass += 1) {
          const result = await helpers.fillPass(root);
          for (const line of result.filled) {
            if (!filled.includes(line)) filled.push(line);
          }
          for (const gap of result.gaps) {
            const key = `${gap.label}|${gap.reason}`;
            if (seen.has(key)) continue;
            seen.add(key);
            gaps.push(gap);
          }
          if (result.filled.length === 0) break;
        }
        return { filled, gaps, pairs: helpers.questionPairs(root) };
      },
      async fillPass(root) {
        const filled = [];
        const gaps = [];
        const handledGroups = new Set();

        const controls = helpers.formControls(root);

        for (const element of controls) {
          // A re-render can detach a control in the middle of the pass: its
          // writes would land on whatever still has focus.
          if (!element.isConnected) continue;
          const type = (element.type || element.tagName || '').toLowerCase();
          const label = helpers.labelText(element);
          const name = helpers.fieldName(element);
          const group = type === 'radio' || type === 'checkbox' ? helpers.groupLabel(element) : '';
          const question = group || label || name;
          const names = [label, name, question].filter(Boolean);
          const aliases = helpers.aliasesFor(names.join(' '));

          if (type === 'radio') {
            const groupKey = element.getAttribute('name') || question;
            if (handledGroups.has(groupKey)) continue;
            handledGroups.add(groupKey);
            const scope2 = element.closest('fieldset, [role="radiogroup"]') || root;
            const radios = Array.from(scope2.querySelectorAll('input[type="radio"]'));
            const options = radios.map((radio) => helpers.optionText(radio)).filter(Boolean);
            const wanted = helpers.answerFor(names, aliases);
            if (wanted === null) {
              if (helpers.isRequired(element, question)) {
                gaps.push({ label: question, type: 'radio', id: element.id, options: options.slice(0, 12), reason: 'no_answer' });
              }
              continue;
            }
            let target =
              radios.find((radio) => helpers.norm(helpers.optionText(radio)) === helpers.norm(wanted)) ||
              radios.find((radio) => helpers.norm(helpers.optionText(radio)).includes(helpers.norm(wanted)));
            if (!target) {
              const index = options.findIndex((option) => helpers.norm(option) === helpers.norm(wanted));
              if (index >= 0 && radios[index]) target = radios[index];
            }
            if (!target) {
              if (helpers.isRequired(element, question)) {
                gaps.push({ label: question, type: 'radio', id: element.id, options: options.slice(0, 12), reason: 'option_not_found' });
              }
              continue;
            }
            if (!target.checked) {
              // The real input can be 0x0 with an empty label; the row the
              // page paints is what the person actually clicks.
              const radioLabel = target.id ? document.querySelector(`label[for="${CSS.escape(target.id)}"]`) : null;
              const row = helpers.optionRow ? helpers.optionRow(target) : null;
              (row || radioLabel || target).click();
            }
            filled.push(`${question}: ${wanted}`);
            continue;
          }

          if (type === 'checkbox') {
            // Following a company is a subscription, not a question.
            if (helpers.subscriptionControl(question)) continue;
            const groupKey = element.getAttribute('name') || question;
            if (handledGroups.has(groupKey)) continue;
            handledGroups.add(groupKey);
            const wanted = helpers.answerFor(names, aliases);
            if (wanted === null) {
              if (helpers.isRequired(element, question)) {
                gaps.push({ label: question, type: 'checkbox', id: element.id, options: [], reason: 'no_answer' });
              }
              continue;
            }
            const shouldCheck = ['true', 'yes', 'checked'].includes(helpers.norm(wanted));
            if (Boolean(element.checked) !== shouldCheck) element.click();
            filled.push(`${question}: ${shouldCheck ? 'checked' : 'unchecked'}`);
            continue;
          }

          const held = String(element.value || '').trim();
          if (held) {
            // A value the page holds is the user's own confirmed data. The
            // phone field is the exception: it does not take a country code.
            if (type === 'tel') {
              const local = helpers.answerFor(names, aliases);
              const digits = held.replace(/\D/g, '');
              const localDigits = String(local || '').replace(/\D/g, '');
              if (localDigits && digits.endsWith(localDigits) && digits !== localDigits) {
                helpers.setValue(element, localDigits);
                filled.push(`${question}: country code removed`);
              } else {
                filled.push(`${question}: already filled`);
              }
            } else {
              // A combobox only counts when a suggestion is picked.
              const combobox =
                element.getAttribute('aria-autocomplete') === 'list' ||
                /location|city|company|school|university|institution/i.test(
                  element.getAttribute('componentkey') || '',
                );
              const wantedValue = helpers.answerFor(names, aliases);
              // A draft can hold text from an earlier run. A confirmed answer
              // that differs from it wins over the stale value.
              if (!combobox && wantedValue && helpers.norm(String(wantedValue)) !== helpers.norm(held)) {
                helpers.setValue(element, String(wantedValue));
                filled.push(`${question}: ${wantedValue}`);
                continue;
              }
              if (combobox && wantedValue) {
                helpers.setValue(element, String(wantedValue));
                const suggestion = await helpers.pickSuggestion(element, String(wantedValue));
                if (suggestion) {
                  filled.push(`${question}: ${suggestion}`);
                  continue;
                }
                helpers.setValue(element, held);
              }
              const heldError = helpers.controlError(element);
              if (heldError.message || heldError.over) {
                const repaired = await helpers.repairValue(element, held);
                if (repaired) {
                  filled.push(`${question}: ${repaired}`);
                  continue;
                }
              }
              filled.push(`${question}: already filled`);
            }
            continue;
          }

          const wanted = helpers.answerFor(names, aliases);
          if (wanted === null || wanted === undefined || wanted === '') {
            if (helpers.isRequired(element, label)) {
              gaps.push({ label: question, type, id: element.id, reason: 'no_answer' });
            }
            continue;
          }

          if (element.maxLength > 0 && String(wanted).length > element.maxLength) {
            helpers.setValue(element, String(wanted));
            const shortened = await helpers.repairValue(element, String(wanted));
            if (shortened) {
              filled.push(`${question}: ${shortened}`);
              continue;
            }
            gaps.push({ label: question, type, id: element.id, reason: 'answer_too_long', maxLength: element.maxLength });
            continue;
          }

          if (element.tagName === 'SELECT') {
            let option = helpers.matchOption(element, wanted);
            // The country list hydrates its options after the select, sometimes
            // several seconds later on a cold job page.
            for (let attempt = 0; attempt < 12 && !option; attempt += 1) {
              await new Promise((resolve) => setTimeout(resolve, 700));
              option = helpers.matchOption(element, wanted);
            }
            if (!option) {
              if (helpers.isRequired(element, label)) {
                gaps.push({
                  label: question,
                  type: 'select',
                  id: element.id,
                  options: Array.from(element.options).map((item) => item.label).filter(Boolean).slice(0, 12),
                  reason: 'option_not_found',
                });
              }
              continue;
            }
            helpers.setValue(element, option.value);
            filled.push(`${question}: ${option.label}`);
            continue;
          }

          const wantsSuggestion =
            element.getAttribute('aria-autocomplete') === 'list' ||
            /location|city|company|school|university|institution/i.test(
              `${element.getAttribute('componentkey') || ''} ${question}`,
            );
          helpers.setValue(element, String(wanted));
          // An email or phone field has no suggestion list: waiting for one
          // burns the per-job budget.
          let suggestion = wantsSuggestion
            ? await helpers.pickSuggestion(element, String(wanted))
            : null;
          let error = helpers.controlError(element);
          if (error.message || error.over) {
            const repaired = await helpers.repairValue(element, String(wanted));
            if (repaired) {
              suggestion = repaired;
              error = helpers.controlError(element);
            }
          }
          if ((error.message || error.over) && helpers.isRequired(element, label)) {
            gaps.push({
              label: question,
              type,
              id: element.id,
              reason: error.over ? 'answer_too_long' : 'invalid_input',
              message: error.message || `longer than ${error.max}`,
              value: String(element.value || '').slice(0, 40),
            });
            continue;
          }
          filled.push(`${question}: ${suggestion || 'filled'}`);
        }

        return { filled, gaps };
      },
});
