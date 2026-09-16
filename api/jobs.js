async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://markeley88.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

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
    .split(',').map(item => item.trim()).filter(Boolean))];
  const location = String(query.location || 'London').trim();
  const salary = Number(query.minSalary ?? query.salary ?? 0);

  let where = location;
  if (/^(uk|united kingdom)$/i.test(location) || /uk\s*\/\s*london\s*\/\s*hybrid/i.test(location)) where = 'London';
  if (where) where = where.split('/')[0].trim();

  async function searchAdzuna(keyword) {
    const params = new URLSearchParams({ app_id: appId, app_key: appKey, results_per_page: '30', what: keyword, sort_by: 'date' });
    if (salary > 0) params.set('salary_min', String(salary));
    if (where) params.set('where', where);
    const response = await fetch('https://api.adzuna.com/v1/api/jobs/gb/search/1?' + params.toString(), { headers: { Accept: 'application/json' } });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`Adzuna returned an invalid response for "${keyword}".`); }
    if (!response.ok) throw new Error(`Adzuna rejected the "${keyword}" search (${response.status}).`);
    return (data.results || []).map(job => ({
      title: job.title || 'Untitled role', company: job.company?.display_name || 'Unknown company', location: job.location?.display_name || 'UK',
      salary: formatSalary(job.salary_min, job.salary_max), salaryMin: typeof job.salary_min === 'number' ? job.salary_min : null,
      salaryMax: typeof job.salary_max === 'number' ? job.salary_max : null, url: job.redirect_url || '',
      description: stripHtml(job.description || ''), created: job.created || '', source: 'Adzuna'
    }));
  }

  async function searchJooble(searchKeywords) {
    if (!joobleApiKey || !searchKeywords.length) return [];
    const response = await fetch(`https://uk.jooble.org/api/${encodeURIComponent(joobleApiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ keywords: searchKeywords.join(', '), location: where || 'London', salary: salary > 0 ? salary : undefined, page: 1, ResultOnPage: 30, companysearch: false })
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`Jooble returned an invalid response for "${searchKeywords.join(', ')}".`); }
    if (!response.ok) throw new Error(`Jooble rejected the search (${response.status}).`);
    return (data.jobs || []).map(job => ({
      title: job.title || 'Untitled role', company: job.company || 'Unknown company', location: job.location || 'UK', salary: job.salary || 'Salary not disclosed',
      salaryMin: null, salaryMax: null, url: job.link || '', description: stripHtml(job.snippet || ''), created: job.updated || '', source: 'Jooble'
    }));
  }

  async function searchReed(keyword) {
    if (!reedApiKey) return [];
    const params = new URLSearchParams({ keywords: keyword, resultsToTake: '30' });
    if (where) params.set('locationName', where);
    if (salary > 0) params.set('minimumSalary', String(salary));
    const auth = Buffer.from(`${reedApiKey}:`).toString('base64');
    const response = await fetch('https://www.reed.co.uk/api/1.0/search?' + params.toString(), { headers: { Accept: 'application/json', Authorization: `Basic ${auth}` } });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`Reed returned an invalid response for "${keyword}".`); }
    if (!response.ok) throw new Error(`Reed rejected the "${keyword}" search (${response.status}).`);
    const rows = Array.isArray(data) ? data : data.results || [];
    return rows.map(job => ({
      title: job.jobTitle || job.title || 'Untitled role', company: job.employerName || job.employer || 'Unknown company', location: job.locationName || job.location || 'UK',
      salary: formatSalary(job.minimumSalary, job.maximumSalary), salaryMin: typeof job.minimumSalary === 'number' ? job.minimumSalary : null,
      salaryMax: typeof job.maximumSalary === 'number' ? job.maximumSalary : null, url: job.jobUrl || job.url || `https://www.reed.co.uk/jobs/${job.jobId || job.id}`,
      description: stripHtml(job.jobDescription || job.description || ''), created: job.datePosted || job.date || '', source: 'Reed'
    }));
  }

  const directBoards = {
    greenhouse: [{ company: 'Tide', token: 'tide' }],
    lever: [{ company: 'Zopa', token: 'zopa' }],
    ashby: [
      { company: 'Allica Bank', token: 'allica-bank' }, { company: 'Funding Circle', token: 'fundingcircle' },
      { company: 'Griffin', token: 'griffin' }, { company: 'Lendable', token: 'lendable' },
      { company: 'Gradient Labs', token: 'gradient-labs' }, { company: 'Taptap Send', token: 'TaptapSend' }
    ]
  };

  function matchesDirectSearch(job) {
    const haystack = normalise(`${job.title} ${job.description || ''}`);
    return keywords.map(normalise).some(term => {
      const words = term.split(' ').filter(Boolean);
      return words.length && (haystack.includes(term) || words.every(word => haystack.split(' ').includes(word)));
    });
  }

  async function searchGreenhouse(board) {
    const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.token)}/jobs?content=true`, { headers: { Accept: 'application/json' } });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.jobs || []).map(job => ({ title: job.title || 'Untitled role', company: board.company, location: job.location?.name || 'UK', salary: extractSalaryFromText(job.content || ''), salaryMin: null, salaryMax: null, url: job.absolute_url || '', description: stripHtml(job.content || ''), created: job.updated_at || '', source: `Direct - ${board.company}` })).filter(matchesDirectSearch);
  }

  async function searchLever(board) {
    const response = await fetch(`https://api.lever.co/v0/postings/${encodeURIComponent(board.token)}?mode=json`, { headers: { Accept: 'application/json' } });
    if (!response.ok) return [];
    const data = await response.json();
    return (Array.isArray(data) ? data : []).map(job => ({ title: job.text || 'Untitled role', company: board.company, location: job.categories?.location || 'UK', salary: job.salaryRange ? formatSalary(job.salaryRange.min, job.salaryRange.max) : 'Salary not disclosed', salaryMin: typeof job.salaryRange?.min === 'number' ? job.salaryRange.min : null, salaryMax: typeof job.salaryRange?.max === 'number' ? job.salaryRange.max : null, url: job.hostedUrl || job.applyUrl || '', description: stripHtml(job.descriptionPlain || job.description || ''), created: job.createdAt ? new Date(job.createdAt).toISOString() : '', source: `Direct - ${board.company}` })).filter(matchesDirectSearch);
  }

  async function searchAshby(board) {
    const response = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board.token)}?includeCompensation=true`, { headers: { Accept: 'application/json' } });
    if (!response.ok) return [];
    const data = await response.json();
    return (data.jobs || []).map(job => {
      const components = job.compensation?.summaryComponents || [];
      const salaryComponent = components.find(item => item.compensationType === 'Salary');
      return { title: job.title || 'Untitled role', company: board.company, location: job.location || 'UK', salary: salaryComponent ? formatSalary(salaryComponent.minValue, salaryComponent.maxValue) : 'Salary not disclosed', salaryMin: typeof salaryComponent?.minValue === 'number' ? salaryComponent.minValue : null, salaryMax: typeof salaryComponent?.maxValue === 'number' ? salaryComponent.maxValue : null, url: job.jobUrl || job.applyUrl || '', description: stripHtml(job.description || job.summary || ''), created: '', source: `Direct - ${board.company}` };
    }).filter(matchesDirectSearch);
  }

  async function searchDirectEmployers() {
    const requests = [...directBoards.greenhouse.map(searchGreenhouse), ...directBoards.lever.map(searchLever), ...directBoards.ashby.map(searchAshby)];
    const settled = await Promise.allSettled(requests);
    return settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  }

  try {
    const sourceTasks = [...keywords.map(keyword => ({ source: 'Adzuna', promise: searchAdzuna(keyword) })), { source: 'Jooble', promise: searchJooble(keywords) }, { source: 'Direct employer ATS', promise: searchDirectEmployers() }];
    if (reedApiKey) sourceTasks.push(...keywords.map(keyword => ({ source: 'Reed', promise: searchReed(keyword) })));

    const settled = await Promise.allSettled(sourceTasks.map(task => task.promise));
    const jobs = [];
    const sourceErrors = [];
    settled.forEach((result, index) => {
      const task = sourceTasks[index];
      if (result.status === 'rejected') { sourceErrors.push({ source: task.source, error: result.reason?.message || String(result.reason) }); return; }
      for (const job of result.value) {
        const existing = findMatchingJob(jobs, job);
        if (existing) mergeSource(existing, job); else jobs.push(createJob(job));
      }
    });

    // Final relevance gate: retrieval stays broad, but only genuinely relevant senior
    // operations/change/transformation titles are returned to the UI.
    const filteredJobs = jobs.filter(job => isRelevantJob(job, keywords, salary));
    filteredJobs.sort((a, b) => relevanceScore(b, keywords, salary) - relevanceScore(a, keywords, salary));

    const enabledSources = ['Adzuna', 'Direct employer ATS'];
    if (joobleApiKey) enabledSources.push('Jooble');
    if (reedApiKey) enabledSources.push('Reed');
    res.status(200).json({ count: filteredJobs.length, sources: enabledSources, sourceErrors, jobs: filteredJobs });
  } catch (error) {
    res.status(502).json({ error: 'Unable to search job sources.', details: error?.message || String(error) });
  }
}

const TARGET_ROLE_PATTERNS = [
  /\bhead of operations\b/i, /\bdirector of operations\b/i, /\boperations director\b/i,
  /\bchief operating officer\b/i, /\bcoo\b/i, /\bhead of transformation\b/i,
  /\btransformation director\b/i, /\bhead of change\b/i, /\bchief transformation officer\b/i,
  /\bhead of strategy\s*(?:&|and)\s*transformation\b/i, /\boperations\s*(?:&|and)\s*transformation director\b/i,
  /\bdirector of business operations\b/i, /\bhead of operational excellence\b/i,
  /\bhead of change\s*(?:&|and)\s*transformation\b/i, /\bhead of strategy\s*,?\s*operations\s*(?:&|and)\s*transformation\b/i,
  /\bhead of strategy and operations\b/i, /\bstrategy and transformation director\b/i,
  /\bchange and transformation director\b/i, /\boperations transformation director\b/i
];

const RELATED_ROLE_PATTERNS = [
  /\bhead of business operations\b/i, /\bhead of service delivery\b/i, /\bhead of customer operations\b/i,
  /\bhead of operational change\b/i, /\bhead of continuous improvement\b/i,
  /\bhead of operating model\b/i, /\bdirector of service delivery\b/i,
  /\bdirector of customer operations\b/i, /\bdirector of operational excellence\b/i,
  /\bdirector of business change\b/i, /\bdirector of change delivery\b/i,
  /\bdirector of transformation delivery\b/i, /\bchief of staff\b.*\boperations\b/i
];

const SENIORITY = /\b(head|director|chief|vp|vice president|managing director|executive director)\b/i;
const FIN_SERVICES = /\b(bank|banking|fintech|payments?|lender|lending|financial services?|mortgage|savings|credit|insurance|insurtech|consumer finance|wealth|asset management|regulated)\b/i;
const OPERATIONS_REMIT = /\b(operations?|operational excellence|operating model|service delivery|customer operations|business operations|process(?:es)?|controls?|servicing|change|transformation|continuous improvement|target operating model)\b/i;
const EXCLUDED_TITLE = /\b(operations? manager|operations? analyst|operations? coordinator|sales operations|marketing operations|hr operations|people operations|it operations|technical operations|clinical operations|warehouse operations|logistics operations|retail operations|store operations|restaurant operations|property operations|revenue operations|commercial operations)\b/i;
const CONSULTING_TITLE = /\b(consultant|consultancy|advisory|professional services)\b/i;

function requestedTitleMatch(title, keywords) {
  const t = normalise(title);
  return keywords.some(keyword => {
    const k = normalise(keyword);
    return k && (t === k || t.includes(k));
  });
}

function matchesAny(patterns, title) { return patterns.some(pattern => pattern.test(title)); }

function isRelevantJob(job, keywords, minimumSalary) {
  const title = String(job.title || '');
  const titleTarget = matchesAny(TARGET_ROLE_PATTERNS, title);
  const titleRelated = matchesAny(RELATED_ROLE_PATTERNS, title);
  const requested = requestedTitleMatch(title, keywords);
  const senior = SENIORITY.test(title);
  const finance = FIN_SERVICES.test(`${title} ${job.company} ${job.description || ''}`);
  const remit = OPERATIONS_REMIT.test(title);
  const excluded = EXCLUDED_TITLE.test(title);
  const consulting = CONSULTING_TITLE.test(title);
  const disclosedBelowTarget = typeof job.salaryMin === 'number' && minimumSalary > 0 && job.salaryMin < minimumSalary;

  // Title is the primary gate. Operations/change language only in the description
  // cannot make an otherwise unrelated senior role pass.
  const strongTitle = titleTarget || requested || titleRelated;
  if (!strongTitle || !senior || excluded || consulting || disclosedBelowTarget) return false;
  if (!remit && !titleTarget && !requested) return false;
  if (!finance) return false;
  return true;
}

function relevanceScore(job, keywords, minimumSalary) {
  const title = String(job.title || '');
  const text = `${title} ${job.company} ${job.location || ''} ${job.description || ''}`;
  const target = matchesAny(TARGET_ROLE_PATTERNS, title);
  const related = matchesAny(RELATED_ROLE_PATTERNS, title);
  const requested = requestedTitleMatch(title, keywords);
  const finance = FIN_SERVICES.test(text);
  const location = /\b(london|uk|united kingdom|england|hybrid|remote)\b/i.test(text);
  const salaryOk = !(typeof job.salaryMin === 'number' && minimumSalary > 0) || job.salaryMin >= minimumSalary;
  let score = 0;
  if (target) score += 50; else if (requested || related) score += 35;
  if (SENIORITY.test(title)) score += 20;
  if (finance) score += 15;
  if (OPERATIONS_REMIT.test(title)) score += 10;
  if (location) score += 5;
  if (salaryOk) score += 5;
  if (CONSULTING_TITLE.test(title)) score -= 40;
  if (EXCLUDED_TITLE.test(title)) score -= 60;
  return Math.max(0, Math.min(100, score));
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
  existing.sources = existing.sources || []; existing.applyOptions = existing.applyOptions || [];
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
