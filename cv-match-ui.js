/* CV Match: separate evidence-based requirement scoring */
(() => {
  const CV_KEY = 'ai-job-hunter-cv-v1';
  const API = 'https://ai-job-hunter-vert.vercel.app/api/cv-match';

  function getCv() { return localStorage.getItem(CV_KEY) || ''; }
  function setCv(value) { localStorage.setItem(CV_KEY, value.trim()); }
  function getStoredJobs() { try { return JSON.parse(localStorage.getItem('ai-job-hunter-jobs-v1')) || []; } catch { return []; } }
  function saveStoredJobs(jobs) { localStorage.setItem('ai-job-hunter-jobs-v1', JSON.stringify(jobs)); }
  function esc(value) { return String(value || '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }

  function openCvModal() {
    let dialog = document.querySelector('#cv-modal');
    if (!dialog) return;
    document.querySelector('#cv-profile').value = getCv();
    document.querySelector('#cv-status').textContent = getCv() ? 'CV saved in this browser.' : '';
    dialog.showModal();
  }

  function renderStoredMatch(card, job) {
    const result = job.cvMatch;
    const badge = card.querySelector('.cv-match-badge');
    const summary = card.querySelector('.cv-match-summary');
    if (!result || typeof result.overallScore !== 'number') {
      badge.hidden = true;
      summary.hidden = true;
      return;
    }
    badge.hidden = false;
    badge.textContent = `📄 CV Match · ${result.overallScore}%`;
    badge.className = `cv-match-badge ${result.overallScore >= 80 ? 'high' : result.overallScore >= 60 ? 'medium' : 'low'}`;
    summary.hidden = false;
    summary.innerHTML = `<strong>${result.matchedCount || 0}/${result.requirementCount || 0} requirements matched</strong>${result.partialCount ? ` · ${result.partialCount} partial` : ''}${result.missingCount ? ` · ${result.missingCount} missing` : ''}<br><span>${esc(result.summary || '')}</span><button type="button" class="view-cv-match">View requirement breakdown</button>`;
    summary.querySelector('.view-cv-match').addEventListener('click', () => showBreakdown(job));
  }

  function findJobForCard(card) {
    const title = card.querySelector('h3')?.textContent || '';
    const company = card.querySelector('.company')?.textContent || '';
    const jobs = getStoredJobs();
    return jobs.find(job => String(job.title || '') === title && String(job.company || '') === company) || null;
  }

  async function scoreJob(card) {
    const cv = getCv();
    if (!cv) { openCvModal(); return; }
    const job = findJobForCard(card);
    if (!job) return;
    const button = card.querySelector('.score-cv');
    const description = job.description || card.querySelector('.description-body')?.textContent || '';
    if (!description.trim()) {
      showMessage('This role has no job description available to compare against your CV.');
      return;
    }
    button.disabled = true;
    button.textContent = 'Analysing…';
    try {
      const response = await fetch(API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: job.title, company: job.company, description, cv })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to score this role.');
      const jobs = getStoredJobs();
      const index = jobs.findIndex(item => item.id === job.id);
      if (index >= 0) { jobs[index].cvMatch = data; saveStoredJobs(jobs); }
      renderStoredMatch(card, { ...job, cvMatch: data });
      button.textContent = '↻ Re-score CV';
    } catch (error) {
      button.textContent = '📄 Score against CV';
      showMessage(error.message || 'Unable to score this role right now.');
    } finally { button.disabled = false; }
  }

  function showBreakdown(job) {
    const result = job.cvMatch;
    if (!result) return;
    const old = document.querySelector('#cv-breakdown-modal');
    if (old) old.remove();
    const dialog = document.createElement('dialog');
    dialog.id = 'cv-breakdown-modal'; dialog.className = 'modal cv-breakdown-modal';
    const rows = (items, cls, label, evidenceKey) => (items || []).map(item => `<div class="requirement-row ${cls}"><div><strong>${esc(item.requirement)}</strong><p>${esc(item[evidenceKey] || '')}</p></div></div>`).join('');
    dialog.innerHTML = `<div class="modal-header"><div><p class="eyebrow">CV Match</p><h2>${esc(job.title)}</h2><p class="company">${esc(job.company)}</p></div><button class="icon-button" type="button" id="cv-breakdown-close">×</button></div>
      <div class="cv-score-hero"><strong>${result.overallScore}%</strong><span>${result.matchedCount || 0} of ${result.requirementCount || 0} requirements fully matched</span><small>${result.partialCount || 0} partial · ${result.missingCount || 0} missing</small></div>
      <p class="cv-summary">${esc(result.summary || '')}</p>
      <section><h3>Matched requirements</h3>${rows(result.matched, 'matched', 'Matched', 'evidence') || '<p>None identified.</p>'}</section>
      <section><h3>Partial matches</h3>${rows(result.partial, 'partial', 'Partial', 'evidence') || '<p>None identified.</p>'}</section>
      <section><h3>Missing requirements</h3>${rows(result.missing, 'missing', 'Missing', 'whyMissing') || '<p>None identified.</p>'}</section>
      <section><h3>Priority gaps</h3><ul>${(result.priorityGaps || []).map(x => `<li>${esc(x)}</li>`).join('') || '<li>None identified.</li>'}</ul></section>
      <section><h3>Transferable strengths</h3><ul>${(result.transferableStrengths || []).map(x => `<li>${esc(x)}</li>`).join('') || '<li>None identified.</li>'}</ul></section>`;
    document.body.appendChild(dialog); dialog.showModal();
    dialog.querySelector('#cv-breakdown-close').onclick = () => dialog.close();
  }

  function showMessage(message) { alert(message); }

  function wireCards() {
    document.querySelectorAll('.job-card').forEach(card => {
      const job = findJobForCard(card);
      if (job) renderStoredMatch(card, job);
      const button = card.querySelector('.score-cv');
      if (button && !button.dataset.cvWired) { button.dataset.cvWired = '1'; button.addEventListener('click', () => scoreJob(card)); }
    });
  }

  document.querySelectorAll('[data-open-cv]').forEach(button => button.addEventListener('click', openCvModal));
  document.querySelectorAll('[data-close-cv]').forEach(button => button.addEventListener('click', () => document.querySelector('#cv-modal')?.close()));
  const cvForm = document.querySelector('#cv-form');
  if (cvForm) cvForm.addEventListener('submit', event => {
    event.preventDefault();
    const value = document.querySelector('#cv-profile').value.trim();
    if (!value) return;
    setCv(value);
    document.querySelector('#cv-status').textContent = 'CV saved. You can now score roles against it.';
    wireCards();
    setTimeout(() => document.querySelector('#cv-modal')?.close(), 500);
  });

  const observer = new MutationObserver(wireCards);
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(wireCards, 200);
})();
