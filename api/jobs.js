async function handler(req, res) {
  // Allow requests from your GitHub Pages app
  res.setHeader(
    'Access-Control-Allow-Origin',
    'https://markeley88.github.io'
  );
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

  if (!appId || !appKey) {
    res.status(500).json({
      error: 'Adzuna API credentials are not configured on the server.'
    });
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

  if (
    /^(uk|united kingdom)$/i.test(location) ||
    /uk\s*\/\s*london\s*\/\s*hybrid/i.test(location)
  ) {
    where = 'London';
  }

  if (where) {
    where = where.split('/')[0].trim();
  }

  async function searchAdzuna(keyword) {
    const params = new URLSearchParams();
    params.set('app_id', appId);
    params.set('app_key', appKey);
    params.set('results_per_page', '30');
    params.set('what', keyword);
    params.set('sort_by', 'date');

    if (salary > 0) params.set('salary_min', String(salary));
    if (where) params.set('where', where);

    const url =
      'https://api.adzuna.com/v1/api/jobs/gb/search/1?' +
      params.toString();

    const response = await fetch(url, {
      headers: { Accept: 'application/json' }
    });

    const text = await response.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Adzuna returned an invalid response for "${keyword}".`);
    }

    if (!response.ok) {
      throw new Error(`Adzuna rejected the "${keyword}" search (${response.status}).`);
    }

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

    const response = await fetch(
      `https://jooble.org/api/${encodeURIComponent(joobleApiKey)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          keywords: keyword,
          location: where || 'London',
          salary: salary > 0 ? salary : undefined,
          page: 1,
          ResultOnPage: 30,
          companysearch: false
        })
      }
    );

    const text = await response.text();
    let data;

    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Jooble returned an invalid response for "${keyword}".`);
    }

    if (!response.ok) {
      throw new Error(`Jooble rejected the "${keyword}" search (${response.status}).`);
    }

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

  try {
    const results = await Promise.all(
      keywords.flatMap(keyword => [
        searchAdzuna(keyword),
        searchJooble(keyword)
      ])
    );

    const jobs = [];

    for (const resultSet of results) {
      for (const job of resultSet) {
        const existing = findMatchingJob(jobs, job);

        if (existing) {
          mergeSource(existing, job);
        } else {
          jobs.push({
            id: `job-${Date.now()}-${jobs.length}`,
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
            sources: [
              {
                name: job.source,
                url: job.url
              }
            ],
            applyOptions: job.url
              ? [{
                  name: job.source,
                  url: job.url
                }]
              : []
          });
        }
      }
    }

    res.status(200).json({
      count: jobs.length,
      sources: joobleApiKey ? ['Adzuna', 'Jooble'] : ['Adzuna'],
      jobs
    });
  } catch (error) {
    res.status(502).json({
      error: 'Unable to search job sources.',
      details: error?.message || String(error)
    });
  }
}

function findMatchingJob(jobs, candidate) {
  const company = normalise(candidate.company);
  const title = normalise(candidate.title);
  const location = normalise(candidate.location);

  return jobs.find(job => {
    if (normalise(job.company) !== company) return false;

    const exact =
      normalise(job.title) === title &&
      normalise(job.location) === location;

    if (exact) return true;

    const titleSimilarity = tokenSimilarity(normalise(job.title), title);
    const locationMatch =
      !location ||
      !normalise(job.location) ||
      normalise(job.location).includes(location) ||
      location.includes(normalise(job.location));

    return titleSimilarity >= 0.8 && locationMatch;
  });
}

function mergeSource(existing, incoming) {
  if (incoming.url && !existing.sources.some(source => source.url === incoming.url)) {
    existing.sources.push({
      name: incoming.source,
      url: incoming.url
    });
  }

  existing.applyOptions = existing.sources.map(source => ({
    name: source.name,
    url: source.url
  }));

  existing.source = existing.sources.map(source => source.name).join(' + ');

  if (
    (!existing.description || existing.description.length < incoming.description.length) &&
    incoming.description
  ) {
    existing.description = incoming.description;
  }

  if ((!existing.url || existing.url.length === 0) && incoming.url) {
    existing.url = incoming.url;
  }
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
  if (typeof min === 'number' && typeof max === 'number') {
    return `£${Math.round(min).toLocaleString()} – £${Math.round(max).toLocaleString()}`;
  }

  if (typeof min === 'number') {
    return `£${Math.round(min).toLocaleString()}+`;
  }

  if (typeof max === 'number') {
    return `Up to £${Math.round(max).toLocaleString()}`;
  }

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
