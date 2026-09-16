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
  const keywords = String(query.keywords || 'Head of Operations')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
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

  async function searchJooble(keyword) {
    if (!joobleApiKey) return [];

    // Jooble API keys are country-specific. UK keys must use the UK endpoint.
    const response = await fetch(`https://uk.jooble.org/api/${encodeURIComponent(joobleApiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        keywords: keyword,
        location: where || 'London',
        ...(salary > 0 ? { salary } : {}),
        page: 1,
        ResultOnPage: 30,
        companysearch: false
      })
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`Jooble returned an invalid response for "${keyword}".`); }
    if (!response.ok) throw new Error(`Jooble rejected the "${keyword}" search (${response.status}).`);

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

    const params = new URLSearchParams({
      keywords: keyword,
      resultsToTake: '30'
    });
    if (where) params.set('locationName', where);
    if (salary > 0) params.set('minimumSalary', String(salary));

    const auth = Buffer.from(`${reedApiKey}:`).toString('base64');
    const response = await fetch('https://www.reed.co.uk/api/1.0/search?' + params.toString(), {
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${auth}`
      }
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`Reed returned an invalid response for "${keyword}".`); }
    if (!response.ok) throw new Error(`Reed rejected the "${keyword}" search (${response.status}).`);

    const rows = Array.isArray(data) ? data : data.results || [];

    return rows.map(job => {
      const reedUrl = job.jobUrl || job.url || `https://www.reed.co.uk/jobs/${job.jobId || job.id}`;
      return {
        title: job.jobTitle || job.title || 'Untitled role',
        company: job.employerName || job.employer || 'Unknown company',
        location: job.locationName || job.location || 'UK',
        salary: formatSalary(job.minimumSalary, job.maximumSalary),
        salaryMin: typeof job.minimumSalary === 'number' ? job.minimumSalary : null,
        salaryMax: typeof job.maximumSalary === 'number' ? job.maximumSalary : null,
        url: reedUrl,
        description: stripHtml(job.jobDescription || job.description || ''),
        created: job.datePosted || job.date || '',
        source: 'Reed'
      };
    });
  }

  try {
    const results = await Promise.all(
      keywords.flatMap(keyword => [
        searchAdzuna(keyword),
        searchJooble(keyword),
        searchReed(keyword)
      ])
    );

    const jobs = [];
    for (const resultSet of results) {
      for (const job of resultSet) {
        const existing = findMatchingJob(jobs, job);
        if (existing) {
          mergeSource(existing, job);
        } else {
          jobs.push(createJob(job));
        }
      }
    }

    const enabledSources = ['Adzuna'];
    if (joobleApiKey) enabledSources.push('Jooble');
    if (reedApiKey) enabledSources.push('Reed');

    res.status(200).json({ count: jobs.length, sources: enabledSources, jobs });
  } catch (error) {
    res.status(502).json({
      error: 'Unable to search job sources.',
      details: error?.message || String(error)
    });
  }
}

function createJob(job) {
  return {
    id: `job-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title: job.title,
    company: job.company,
    location: job.location,
    salary: job.salary,
    bonus: '',
    url: job.url,
    status: 'Interested',
    description: job.description,
    created: job.created,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    source: job.source,
    sources: job.url ? [{ name: job.source, url: job.url }] : [],
    applyOptions: job.url ? [{ name: job.source, url: job.url }] : []
  };
}

function findMatchingJob(jobs, candidate) {
  const company = normalise(candidate.company);
  const title = normalise(candidate.title);
  const location = normalise(candidate.location);

  return jobs.find(job => {
    if (normalise(job.company) !== company) return false;
    if (candidate.url && job.sources?.some(source => source.url === candidate.url)) return true;

    const existingTitle = normalise(job.title);
    const existingLocation = normalise(job.location);
    if (existingTitle === title && existingLocation === location) return true;

    const locationMatch = !location || !existingLocation || existingLocation.includes(location) || location.includes(existingLocation);
    return tokenSimilarity(existingTitle, title) >= 0.8 && locationMatch;
  });
}

function mergeSource(existing, incoming) {
  existing.sources = existing.sources || [];
  existing.applyOptions = existing.applyOptions || [];

  if (incoming.url && !existing.sources.some(source => source.url === incoming.url)) {
    existing.sources.push({ name: incoming.source, url: incoming.url });
  }

  existing.applyOptions = existing.sources.map(source => ({ name: source.name, url: source.url }));
  existing.source = existing.sources.map(source => source.name).join(' + ');

  if ((!existing.description || existing.description.length < incoming.description.length) && incoming.description) {
    existing.description = incoming.description;
  }

  if ((!existing.salary || existing.salary === 'Salary not disclosed') && incoming.salary && incoming.salary !== 'Salary not disclosed') {
    existing.salary = incoming.salary;
    existing.salaryMin = incoming.salaryMin;
    existing.salaryMax = incoming.salaryMax;
  }

  if (!existing.url && incoming.url) existing.url = incoming.url;
  if (!existing.created && incoming.created) existing.created = incoming.created;
}

function normalise(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(limited|ltd|plc|uk|united kingdom)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSimilarity(a, b) {
  const aTokens = new Set(a.split(' ').filter(Boolean));
  const bTokens = new Set(b.split(' ').filter(Boolean));
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

function stripHtml(text) {
  return String(text)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = handler;
