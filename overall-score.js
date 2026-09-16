/* Combined scoring: balances the two existing signals without changing either one. */
(() => {
  const JOBS_KEY = 'ai-job-hunter-jobs-v1';

  function getJobs() {
    try { return JSON.parse(localStorage.getItem(JOBS_KEY)) || []; } catch { return []; }
  }

  // Geometric mean rewards roles where BOTH existing scores are strong and
  // naturally suppresses roles that are excellent on only one dimension.
  function combinedScore(job) {
    const relevance = Math.max(0, Math.min(100, Number(job.relevanceScore ?? job.score ?? 0)));
    const cv = Number.isFinite(Number(job.cvMatch?.score)) ? Math.max(0, Math.min(100, Number(job.cvMatch.score))) : null;
    if (cv === null) return Math.round(relevance);
    return Math.round(Math.sqrt(relevance * cv));
  }

  function updateScores() {
    const jobs = getJobs();
    let changed = false;
    jobs.forEach(job => {
      const score = combinedScore(job);
      if (job.overallScore !== score) { job.overallScore = score; changed = true; }
    });
    if (changed) localStorage.setItem(JOBS_KEY, JSON.stringify(jobs));
    return jobs;
  }

  function reorderCards(jobs) {
    const list = document.querySelector('#job-list');
    if (!list) return;
    const cards = [...list.querySelectorAll('.job-card')];
    if (!cards.length) return;
    const scoreForCard = card => {
      const title = card.querySelector('h3')?.textContent || '';
      const company = card.querySelector('.company')?.textContent || '';
      const job = jobs.find(j => String(j.title || '') === title && String(j.company || '') === company);
      return job?.overallScore ?? 0;
    };
    cards.sort((a, b) => scoreForCard(b) - scoreForCard(a)).forEach(card => list.appendChild(card));

    cards.forEach(card => {
      const title = card.querySelector('h3')?.textContent || '';
      const company = card.querySelector('.company')?.textContent || '';
      const job = jobs.find(j => String(j.title || '') === title && String(j.company || '') === company);
      if (!job) return;
      let badge = card.querySelector('.overall-score-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'overall-score-badge';
        const existing = card.querySelector('.fit-badge');
        if (existing?.parentElement) existing.parentElement.appendChild(badge);
        else card.prepend(badge);
      }
      const hasCV = Number.isFinite(Number(job.cvMatch?.score));
      badge.textContent = hasCV ? `Overall fit · ${job.overallScore}/100` : `Overall fit · ${job.overallScore}/100`;
      badge.title = hasCV
        ? `Combined from role relevance (${job.relevanceScore ?? job.score}/100) and CV match (${job.cvMatch.score}/100).`
        : 'Based on the existing role relevance score. Add your CV to activate the combined score.';
    });
  }

  function refresh() {
    const jobs = updateScores();
    reorderCards(jobs);
  }

  const list = document.querySelector('#job-list');
  if (list) new MutationObserver(() => refresh()).observe(list, { childList: true, subtree: true });
  window.addEventListener('load', refresh);
  refresh();
})();
