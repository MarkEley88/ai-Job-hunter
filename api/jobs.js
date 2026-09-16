async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://markeley88.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  const joobleApiKey = process.env.JOOBLE_API_KEY;
  const reedApiKey = process.env.REED_API_KEY;

  if (!appId || !appKey) {
    res.status(500).json({ error: 'Adzuna API credentials are not configured on the server.' });
    return;
  }

  const query = req.query || {};
  const keywords = [...new Set(String(query.keywords || 'Head of Operations')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean))];
  const location = String(query.location || 'London').trim();
  const salary = Number(query.minSalary ?? query.salary ?? 0);

  let where = location;
  if (/^(uk|united kingdom)$/i.test(location) || /uk\s*\/\s*london\s*\/\s*hybrid/i.test(location)) {
    where = 'London';
  }
  if (where) where = where.split('/')[0].trim();

  async function searchAdzuna(keyword) {
    const params = new URLSearchParams({
      app_id: appId,
      app_key: appKey,
      results_per_page: '30',
      what: keyword,
      sort_by: 'date'
    });
    if (salary > 0) params.set('salary_min', String(salary));
    if (where) params.set('where', where);

    const response = await fetch('https://api.adzuna.com/v1/api/jobs/gb/search/1?' + params.toString(), {
      headers: { Accept: 'application/json' }
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`Adzuna returned an invalid response for "${keyword}".`); }
    if (!response.ok) throw new Error(`Adzuna rejected the "${keyword}" search (${response.status}).`);

    return (data.results || []).map(job => ({
      title: job.title || 'Untitled role',
      company: job.company?.display_name || 'Unknown company',
      location: job.location?.display_name || 'UK',
      salary: formatSalary(job.salary_min, job.salary_max),
      salaryMin: typeof job.salary_min === 'number' ? job.salary_min : null,
      salaryMax: typeof job.salary_max === 'number' ? job.salary_max : null,
      url: job.redirect_url || '',
      description: stripHtml(job.description || ''),
      created: job.created || '',
      source: 'Adzuna'
    }));
  }

  async function searchJooble(searchKeywords) {
    if (!joobleApiKey || !searchKeywords.length) return [];

    const response = await fetch(`https://uk.jooble.org/api/${encodeURIComponent(joobleApiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        keywords: searchKeywords.join(', '),
        location: where || 'London',
        salary: salary > 0 ? salary : undefined,
        page: 1,
        ResultOnPage: 30,
        companysearch: false
      })
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`Jooble returned an invalid response for "${searchKeywords.join(', ')}".`); }
    if (!response.ok) throw new Error(`Jooble rejected the search (${response.status}).`);

    return (data.jobs || []).map(job => ({
      title: job.title || 'Untitled role',
      company: job.company || 'Unknown company',
      location: job.location || 'UK',
      salary: job.salary || 'Salary not disclosed',
      salaryMin: null,
      salaryMax: null,
      url: job.link || '',
      description: stripHtml(job.snippet || ''),
      created: job.updated || '',
      source: 'Jooble'
    }));
  }

  async function searchReed(keyword) {
    if (!reedApiKey) return [];

    const params = new URLSearchParams({ keywords: keyword, resultsToTake: '30' });
    if (where) params.set('locationName', where);
    if (salary > 0) params.set('minimumSalary', String(salary));

    const auth = Buffer.from(`${reedApiKey}:`).toString('base64');
    const response = await fetch('https://www.reed.co.uk/api/1.0/search?' + params.toString(), {
      headers: { Accept: 'application/json', Authorization: `Basic ${auth}` }
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`Reed returned an invalid response for "${keyword}".`); }
    if (!response.ok) throw new Error(`Reed rejected the "${keyword}" search (${response.status}).`);

    const rows = Array.isArray(data) ? data : data.results || [];
    return rows.map(job => ({
      title: job.jobTitle || job.title || 'Untitled role',
      company: job.employerName || job.employer || 'Unknown company',
      location: job.locationName || job.location || 'UK',
      salary: formatSalary(job.minimumSalary, job.maximumSalary),
      salaryMin: typeof job.minimumSalary === 'number' ? job.minimumSalary : null,
      salaryMax: typeof job.maximumSalary === 'number' ? job.maximumSalary : null,
      url: job.jobUrl || job.url || `https://www.reed.co.uk/jobs/${job.jobId || job.id}`,
      description: stripHtml(job.jobDescription || job.description || ''),
      created: job.datePosted || job.date || '',
      source: 'Reed'
    }));
  }

  const directBoards = {
    greenhouse: [{ company: 'Tide', token: 'tide' }],
    lever: [{ company: 'Zopa', token: 'zopa' }],
    ashby: [
      { company: 'Allica Bank', token: 'allica-bank' },
      { company: 'Funding Circle', token: 'fundingcircle' },
      { company: 'Griffin', token: 'griffin' },
      { company: 'Lendable', token: 'lendable' },
      { company: 'Gradient Labs', token: 'gradient-labs' },
      { company: 'Taptap Send', token: 'TaptapSend' }
    ]
  };

  function matchesDirectSearch(job) {
    const haystack = normalise(`${job.title} ${job.description || ''}`);
    const wanted = keywords.map(normalise);
    return wanted.some(term => {
      const words = term.split(' ').filter(Boolean);
      return words.length && (haystack.includes(term) || words.every(word => haystack.split(' ').includes(word)));
    });
  }

  async function searchGreenhouse(board) {
    const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.token)}/jobs?content=true`, { headers: { Accept: 'application/json' } });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.jobs || []).map(job => ({
      title: job.title || 'Untitled role', company: board.company, location: job.location?.name || 'UK',
      salary: extractSalaryFromText(job.content || ''), salaryMin: null, salaryMax: null,
      url: job.absolute_url || '', description: stripHtml(job.content || ''), created: job.updated_at || '', source: `Direct - ${board.company}`
    })).filter(matchesDirectSearch);
  }

  async function searchLever(board) {
    const response = await fetch(`https://api.lever.co/v0/postings/${encodeURIComponent(board.token)}?mode=json`, { headers: { Accept: 'application/json' } });
    if (!response.ok) return [];
    const data = await response.json();
    return (Array.isArray(data) ? data : []).map(job => ({
      title: job.text || 'Untitled role', company: board.company, location: job.categories?.location || 'UK',
      salary: job.salaryRange ? formatSalary(job.salaryRange.min, job.salaryRange.max) : 'Salary not disclosed',
      salaryMin: typeof job.salaryRange?.min === 'number' ? job.salaryRange.min : null,
      salaryMax: typeof job.salaryRange?.max === 'number' ? job.salaryRange.max : null,
      url: job.hostedUrl || job.applyUrl || '', description: stripHtml(job.descriptionPlain || job.description || ''),
      created: job.createdAt ? new Date(job.createdAt).toISOString() : '', source: `Direct - ${board.company}`
    })).filter(matchesDirectSearch);
  }

  async function searchAshby(board) {
    const response = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board.token)}?includeCompensation=true`, { headers: { Accept: 'application/json' } });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.jobs || []).map(job => {
      const components = job.compensation?.summaryComponents || [];
      const salaryComponent = components.find(item => item.compensationType === 'Salary');
      return {
        title: job.title || 'Untitled role', company: board.company, location: job.location || 'UK',
        salary: salaryComponent ? formatSalary(salaryComponent.minValue, salaryComponent.maxValue) : 'Salary not disclosed',
        salaryMin: typeof salaryComponent?.minValue === 'number' ? salaryComponent.minValue : null,
        salaryMax: typeof salaryComponent?.maxValue === 'number' ? salaryComponent.maxValue : null,
        url: job.jobUrl || job.applyUrl || '', description: stripHtml(job.description || job.summary || ''), created: '', source: `Direct - ${board.company}`
      };
    }).filter(matchesDirectSearch);
  }

  async function searchDirectEmployers() {
    const requests = [
      ...directBoards.greenhouse.map(searchGreenhouse),
      ...directBoards.lever.map(searchLever),
      ...directBoards.ashby.map(searchAshby)
    ];
    const settled = await Promise.allSettled(requests);
    return settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  }

  try {
    const sourceTasks = [
      ...keywords.map(keyword => ({ source: 'Adzuna', promise: searchAdzuna(keyword) })),
      { source: 'Jooble', promise: searchJooble(keywords) },
      { source: 'Direct employer ATS', promise: searchDirectEmployers() }
    ];
    if (reedApiKey) {
      sourceTasks.push(...keywords.map(keyword => ({ source: 'Reed', promise: searchReed(keyword) })));
    }

    // One failing source must never take down the entire search.
    const settled = await Promise.allSettled(sourceTasks.map(task => task.promise));
    const jobs = [];
    const sourceErrors = [];

    settled.forEach((result, index) => {
      const task = sourceTasks[index];
      if (result.status === 'rejected') {
        sourceErrors.push({ source: task.source, error: result.reason?.message || String(result.reason) });
        return;
      }
      for (const job of result.value) {
        const existing = findMatchingJob(jobs, job);
        if (existing) mergeSource(existing, job);
        else jobs.push(createJob(job));
      }
    });

    const enabledSources = ['Adzuna', 'Direct employer ATS'];
    if (joobleApiKey) enabledSources.push('Jooble');
    if (reedApiKey) enabledSources.push('Reed');

    res.status(200).json({ count: jobs.length, sources: enabledSources, sourceErrors, jobs });
  } catch (error) {
    res.status(502).json({ error: 'Unable to search job sources.', details: error?.message || String(error) });
  }
}

function createJob(job) {
  return { id: `job-${Date.now()}-${Math.random().toString(36).slice(2)}`, title: job.title, company: job.company, location: job.location, salary: job.salary, bonus: '', url: job.url, status: 'Interested', description: job.description, created: job.created, salaryMin: job.salaryMin, salaryMax: job.salaryMax, source: job.source, sources: job.url ? [{ name: job.source, url: job.url }] : [], applyOptions: job.url ? [{ name: job.source, url: job.url }] : [] };
}

function findMatchingJob(jobs, candidate) {
  const company = normalise(candidate.company), title = normalise(candidate.title), location = normalise(candidate.location);
  return jobs.find(job => {
    if (normalise(job.company) !== company) return false;
    if (candidate.url && job.sources?.some(source => source.url === candidate.url)) return true;
    const existingTitle = normalise(job.title), existingLocation = normalise(job.location);
    if (existingTitle === title && existingLocation === location) return true;
    const locationMatch = !location || !existingLocation || existingLocation.includes(location) || location.includes(existingLocation);
    return tokenSimilarity(existingTitle, title) >= 0.8 && locationMatch;
  });
}

function mergeSource(existing, incoming) {
  existing.sources = existing.sources || [];
  existing.applyOptions = existing.applyOptions || [];
  if (incoming.url && !existing.sources.some(source => source.url === incoming.url)) existing.sources.push({ name: incoming.source, url: incoming.url });
  existing.applyOptions = existing.sources.map(source => ({ name: source.name, url: source.url }));
  existing.source = existing.sources.map(source => source.name).join(' + ');
  if ((!existing.description || existing.description.length < incoming.description.length) && incoming.description) existing.description = incoming.description;
  if ((!existing.salary || existing.salary === 'Salary not disclosed') && incoming.salary && incoming.salary !== 'Salary not disclosed') { existing.salary = incoming.salary; existing.salaryMin = incoming.salaryMin; existing.salaryMax = incoming.salaryMax; }
  if (!existing.url && incoming.url) existing.url = incoming.url;
  if (!existing.created && incoming.created) existing.created = incoming.created;
}

function normalise(value) {
  return String(value || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').replace(/\b(limited|ltd|plc|uk|united kingdom)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenSimilarity(a, b) {
  const aTokens = new Set(a.split(' ').filter(Boolean)), bTokens = new Set(b.split(' ').filter(Boolean));
  if (!aTokens.size || !bTokens.size) return 0;
  const intersection = [...aTokens].filter(token => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return union ? intersection / union : 0;
}

function formatSalary(min, max) {
  if (typeof min === 'number' && typeof max === 'number') return `£${Math.round(min).toLocaleString()} – £${Math.round(max).toLocaleString()}`;
  if (typeof min === 'number') return `£${Math.round(min).toLocaleString()}+`;
  if (typeof max === 'number') return `Up to £${Math.round(max).toLocaleString()}`;
  return 'Salary not disclosed';
}

function extractSalaryFromText(text) {
  const match = String(text).match(/£\s?([0-9]{2,3}(?:,[0-9]{3})?)(?:\s?[kK])?/g);
  if (!match?.length) return 'Salary not disclosed';
  return match.slice(0, 2).join(' – ');
}

function stripHtml(text) {
  return String(text).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/\s+/g, ' ').trim();
}

module.exports = handler;
