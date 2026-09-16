/* Combined scoring + score display. All calculations remain local in the browser. */
(() => {
  const JOBS_KEY = 'ai-job-hunter-jobs-v1';
  const getJobs = () => { try { return JSON.parse(localStorage.getItem(JOBS_KEY)) || []; } catch { return []; } };
  const saveJobs = jobs => localStorage.setItem(JOBS_KEY, JSON.stringify(jobs));

  function combinedScore(job) {
    const relevance = Math.max(0, Math.min(100, Number(job.relevanceScore ?? job.score ?? 0)));
    const cv = Number.isFinite(Number(job.cvMatch?.score)) ? Math.max(0, Math.min(100, Number(job.cvMatch.score))) : null;
    return cv === null ? Math.round(relevance) : Math.round(Math.sqrt(relevance * cv));
  }

  function findJob(card, jobs = getJobs()) {
    const title = card.querySelector('h3')?.textContent?.trim() || '';
    const company = card.querySelector('.company')?.textContent?.trim() || '';
    return jobs.find(j => String(j.title || '').trim() === title && String(j.company || '').trim() === company);
  }

  function ensureMetrics(card) {
    let metrics = card.querySelector('.job-score-metrics');
    if (!metrics) {
      metrics = document.createElement('div');
      metrics.className = 'job-score-metrics';
      const anchor = card.querySelector('.fit-badge')?.parentElement || card.firstElementChild;
      if (anchor) anchor.insertAdjacentElement('beforebegin', metrics); else card.prepend(metrics);
    }
    return metrics;
  }

  function makeBadge(className) {
    const el = document.createElement('span');
    el.className = className;
    return el;
  }

  function renderCard(card, job) {
    const metrics = ensureMetrics(card);
    const role = card.querySelector('.fit-badge');
    const cv = card.querySelector('.cv-match-badge');
    const overall = card.querySelector('.overall-score-badge');

    [role, cv, overall].forEach(el => { if (el) { el.hidden = false; metrics.appendChild(el); } });

    if (role) role.textContent = `Role relevance · ${Number(job.relevanceScore ?? job.score ?? 0)}/100`;

    if (cv) {
      if (Number.isFinite(Number(job.cvMatch?.score))) {
        const n = Number(job.cvMatch.score);
        cv.hidden = false;
        cv.className = `cv-match-badge ${n >= 75 ? 'high' : n >= 50 ? 'medium' : 'low'}`;
        cv.textContent = `CV match · ${n}/100`;
      } else {
        cv.hidden = false;
        cv.className = 'cv-match-badge';
        cv.textContent = 'CV match · Not scored';
      }
    }

    if (overall) {
      const n = combinedScore(job);
      overall.hidden = false;
      overall.textContent = `Overall fit · ${n}/100`;
      overall.title = Number.isFinite(Number(job.cvMatch?.score))
        ? `Combined from role relevance (${job.relevanceScore ?? job.score}/100) and CV match (${job.cvMatch.score}/100).`
        : 'Overall fit currently uses role relevance. Score against your CV to activate the combined score.';
    }
  }

  function updateScores() {
    const jobs = getJobs();
    let changed = false;
    jobs.forEach(job => {
      const score = combinedScore(job);
      if (job.overallScore !== score) { job.overallScore = score; changed = true; }
    });
    if (changed) saveJobs(jobs);
    return jobs;
  }

  function refresh() {
    const jobs = updateScores();
    const list = document.querySelector('#job-list');
    if (!list) return;
    const cards = [...list.querySelectorAll('.job-card')];
    const pairs = cards.map(card => ({ card, job: findJob(card, jobs) })).filter(x => x.job);
    pairs.sort((a, b) => (b.job.overallScore ?? 0) - (a.job.overallScore ?? 0));
    pairs.forEach(({ card }) => list.appendChild(card));
    pairs.forEach(({ card, job }) => renderCard(card, job));
  }

  function scoreOne(card) {
    const jobs = getJobs();
    const job = findJob(card, jobs);
    if (!job) return;
    const hasCV = !!(window.cvMatcher?.readCV?.() || '').trim();
    if (!hasCV) {
      document.querySelector('[data-open-cv]')?.click();
      return;
    }
    if (typeof window.cvMatcher?.matchJob !== 'function') return;
    job.cvMatch = window.cvMatcher.matchJob(job);
    job.overallScore = combinedScore(job);
    saveJobs(jobs);
    renderCard(card, job);
    refresh();
  }

  function bindButtons() {
    document.querySelectorAll('.job-card .score-cv').forEach(button => {
      if (button.dataset.overallBound === '1') return;
      button.dataset.overallBound = '1';
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        scoreOne(button.closest('.job-card'));
      }, true);
    });
  }

  const style = document.createElement('style');
  style.textContent = `
    .job-score-metrics{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 10px}
    .job-score-metrics .fit-badge,.job-score-metrics .cv-match-badge,.job-score-metrics .overall-score-badge{display:inline-flex!important;align-items:center;padding:6px 10px;border-radius:999px;font-size:.78rem;font-weight:700;line-height:1.2}
    .job-score-metrics .cv-match-badge.high{background:#e7f6ed;color:#176b3a}
    .job-score-metrics .cv-match-badge.medium{background:#fff4d6;color:#765600}
    .job-score-metrics .cv-match-badge.low{background:#fbe7e7;color:#8a2424}
    .job-score-metrics .overall-score-badge{background:#eee8ff;color:#4d347f}
  `;
  document.head.appendChild(style);

  window.addEventListener('load', () => setTimeout(() => { refresh(); bindButtons(); }, 100));
  window.addEventListener('jobs-rendered', () => { refresh(); bindButtons(); });
  setTimeout(() => { refresh(); bindButtons(); }, 200);
  window.overallScore = { refresh, combinedScore, scoreOne };
})();