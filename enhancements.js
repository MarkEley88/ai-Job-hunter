/* AI Job Hunter - application workflow and AI tailoring enhancements */
(() => {
  const TARGET_MIN = 120000;

  const originalCalculateFit = window.calculateFit;

  function salaryNumbers(value) {
    return String(value || '').match(/\d[\d,]*/g)?.map(v => Number(v.replace(/,/g, ''))) || [];
  }

  function salaryGate(job) {
    const nums = salaryNumbers(job.salary);
    if (!nums.length) return true;
    return Math.max(...nums) >= TARGET_MIN;
  }

  window.calculateFit = function(job) {
    const score = typeof originalCalculateFit === 'function' ? originalCalculateFit(job) : 0;
    if (!salaryGate(job)) return 0;
    return score;
  };

  function addWorkflowControls() {
    document.querySelectorAll('.job-card').forEach(card => {
      if (card.querySelector('.tailor-application')) return;
      const actions = card.querySelector('.job-actions');
      if (!actions) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tailor-application';
      button.textContent = '✦ Tailor application';
      button.addEventListener('click', () => openTailor(card));
      actions.insertBefore(button, actions.querySelector('.delete-job'));
    });
  }

  function openTailor(card) {
    const title = card.querySelector('h3')?.textContent || '';
    const company = card.querySelector('.company')?.textContent || '';
    const description = card.querySelector('.description-body')?.textContent || '';
    const existing = document.querySelector('#tailor-modal');
    if (existing) existing.remove();

    const dialog = document.createElement('dialog');
    dialog.id = 'tailor-modal';
    dialog.className = 'modal tailor-modal';
    dialog.innerHTML = `
      <form method="dialog" id="tailor-form">
        <div class="modal-header"><div><p class="eyebrow">Application assistant</p><h2>Tailor this application</h2></div><button class="icon-button" type="button" id="tailor-close">×</button></div>
        <p class="modal-intro"><strong>${escapeHtml(title)}</strong> at ${escapeHtml(company)}. Paste your CV below and the assistant will tailor the application to this specific role.</p>
        <label class="field full"><span>Your CV / career profile</span><textarea id="tailor-cv" rows="12" required placeholder="Paste your current CV here..."></textarea></label>
        <div class="modal-actions"><button class="btn btn-quiet" type="button" id="tailor-cancel">Cancel</button><button class="btn btn-primary" type="submit">✦ Generate tailored application</button></div>
        <div id="tailor-status" class="tailor-status"></div>
        <div id="tailor-output" class="tailor-output" hidden></div>
      </form>`;
    document.body.appendChild(dialog);
    dialog.showModal();
    document.querySelector('#tailor-close').onclick = () => dialog.close();
    document.querySelector('#tailor-cancel').onclick = () => dialog.close();
    document.querySelector('#tailor-form').addEventListener('submit', async event => {
      event.preventDefault();
      const cv = document.querySelector('#tailor-cv').value.trim();
      const status = document.querySelector('#tailor-status');
      const output = document.querySelector('#tailor-output');
      status.textContent = 'Analysing the role and tailoring your application…';
      output.hidden = true;
      try {
        const response = await fetch('/api/tailor', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, company, description, cv })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to tailor the application.');
        status.textContent = 'Tailored application ready.';
        output.innerHTML = renderTailorResult(data);
        output.hidden = false;
      } catch (error) {
        status.textContent = error.message || 'Unable to tailor the application right now.';
      }
    });
  }

  function renderTailorResult(data) {
    return `<section><h3>Application positioning</h3><p>${escapeHtml(data.positioning || '')}</p></section>
      <section><h3>CV changes to make</h3><ul>${(data.cvChanges || []).map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul></section>
      <section><h3>Key evidence to emphasise</h3><ul>${(data.evidence || []).map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul></section>
      <section><h3>Tailored profile</h3><p>${escapeHtml(data.profile || '')}</p></section>
      <section><h3>Cover letter</h3><p class="cover-letter">${escapeHtml(data.coverLetter || '').replace(/\n/g, '<br>')}</p></section>
      <section><h3>Likely interview questions</h3><ul>${(data.interviewQuestions || []).map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul></section>`;
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  const observer = new MutationObserver(addWorkflowControls);
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(addWorkflowControls, 100);
})();
