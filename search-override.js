(() => {
  // Broaden discovery without weakening the ranking logic. The API still applies
  // seniority/sector/remit checks; this layer simply asks it for a wider set of
  // closely related leadership titles and lets the fit score order the results.
  const button = document.querySelector('#find-jobs-button');
  if (!button) return;
  const replacement = button.cloneNode(true);
  button.replaceWith(replacement);

  const API_URL = 'https://ai-job-hunter-vert.vercel.app/api/jobs';
  const searchStatus = document.querySelector('#search-status');
  const searchResults = document.querySelector('#search-results');
  const statusFilter = document.querySelector('#status-filter');
  const fitFilter = document.querySelector('#fit-filter');

  const broadTitles = [
    'Head of Operations',
    'Director of Operations',
    'Operations Director',
    'Chief Operating Officer',
    'COO',
    'Head of Transformation',
    'Transformation Director',
    'Head of Change',
    'Change Director',
    'Head of Strategy and Transformation',
    'Strategy and Transformation Director',
    'Head of Business Operations',
    'Head of Customer Operations',
    'Head of Operational Excellence',
    'Director of Business Operations',
    'Director of Service Delivery',
    'Director of Change Delivery',
    'Director of Transformation Delivery',
    'Head of Operating Model',
    'Head of Continuous Improvement'
  ];

  function jobsStore() { try { return JSON.parse(localStorage.getItem('ai-job-hunter-jobs-v1')) || []; } catch { return []; } }
  function save(jobs) { localStorage.setItem('ai-job-hunter-jobs-v1', JSON.stringify(jobs)); }
  function norm(v) { return String(v || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function similarity(a, b) {
    const A = new Set(norm(a).split(' ').filter(Boolean)), B = new Set(norm(b).split(' ').filter(Boolean));
    if (!A.size || !B.size) return 0;
    return [...A].filter(x => B.has(x)).length / new Set([...A, ...B]).size;
  }
  function merge(existing, incoming) {
    const result = [...existing];
    incoming.forEach(job => {
      const found = result.find(item => norm(item.company) === norm(job.company) && (
        (job.url && item.url === job.url) ||
        (norm(item.title) === norm(job.title) && (!job.location || !item.location || norm(item.location).includes(norm(job.location)) || norm(job.location).includes(norm(item.location)))) ||
        (similarity(item.title, job.title) >= 0.8 && norm(item.company) === norm(job.company))
      ));
      if (!found) { result.push(job); return; }
      const sources = [...(found.applyOptions || found.sources || [])];
      const incomingSources = job.applyOptions || job.sources || (job.url ? [{ name: job.source || 'Source', url: job.url }] : []);
      incomingSources.forEach(source => { if (source?.url && !sources.some(s => s.url === source.url)) sources.push(source); });
      found.applyOptions = sources; found.sources = sources;
      if (!found.url && job.url) found.url = job.url;
      if ((!found.description || found.description.length < (job.description || '').length) && job.description) found.description = job.description;
      if (typeof job.relevanceScore === 'number' && job.relevanceScore > (found.relevanceScore || 0)) {
        found.relevanceScore = job.relevanceScore; found.score = job.relevanceScore; found.fitRationale = job.fitRationale;
      }
    });
    return result;
  }

  replacement.addEventListener('click', async () => {
    const location = document.querySelector('#search-location').value.trim();
    const salaryTarget = Number(document.querySelector('#search-salary').value) || 120000;
    const sector = document.querySelector('#search-sector').value;
    const userKeywords = document.querySelector('#search-keywords').value.split(',').map(x => x.trim()).filter(Boolean);
    const keywords = [...new Set([...userKeywords, ...broadTitles])];
    replacement.disabled = true;
    searchStatus.textContent = `Searching ${keywords.length} leadership title variations across the available sources…`;
    searchResults.replaceChildren();
    try {
      // Deliberately do not send the £120k floor to discovery. Salary disclosure is
      // inconsistent across job boards; salary remains a ranking factor instead of
      // causing otherwise strong roles to disappear before scoring.
      const params = new URLSearchParams({ keywords: keywords.join(', '), location, minSalary: '0', sector });
      const response = await fetch(`${API_URL}?${params.toString()}`);
      if (!response.ok) throw new Error(`Search failed (${response.status})`);
      const data = await response.json();
      const jobs = Array.isArray(data.jobs) ? data.jobs : [];
      if (!jobs.length) {
        searchStatus.textContent = 'No suitable leadership roles were returned. Try a broader location.';
        return;
      }
      const enriched = jobs.map(job => ({
        ...job,
        id: job.id || `job-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        status: job.status || 'Interested',
        score: typeof job.relevanceScore === 'number' ? job.relevanceScore : (typeof job.score === 'number' ? job.score : 0)
      }));
      save(merge(jobsStore(), enriched));
      statusFilter.value = 'all'; fitFilter.value = 'all';
      // app.js owns rendering; dispatch the same filter event it already handles.
      statusFilter.dispatchEvent(new Event('change'));
      const sourceText = Array.isArray(data.sources) ? data.sources.join(' + ') : 'available sources';
      const errors = Array.isArray(data.sourceErrors) && data.sourceErrors.length ? ` (${data.sourceErrors.length} source issue${data.sourceErrors.length === 1 ? '' : 's'})` : '';
      searchStatus.textContent = `${enriched.length} relevant leadership roles found across ${sourceText}${errors}. Salary is used as a ranking factor so undisclosed-salary roles are not lost.`;
    } catch (error) {
      console.error(error);
      searchStatus.textContent = 'Unable to search right now. Check the API and try again.';
    } finally { replacement.disabled = false; }
  });
})();
