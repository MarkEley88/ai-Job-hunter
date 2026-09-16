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

  // Curated direct employer ATS coverage. Invalid/changed boards fail quietly so one
  // employer never breaks the wider search. The list deliberately focuses on UK
  // banks, fintechs, payments, lenders and wealth firms relevant to the target profile.
  const directBoards = {
    greenhouse: [
      { company: 'Tide', token: 'tide' },
      { company: 'Monzo', token: 'monzo' },
      { company: 'GoCardless', token: 'gocardless' }
    ],
    lever: [
      { company: 'Zopa', token: 'zopa' },
      { company: 'Starling Bank', token: 'starlingbank' }
    ],
    ashby: [
      { company: 'Allica Bank', token: 'allica-bank' },
      { company: 'Funding Circle', token: 'fundingcircle' },
      { company: 'Griffin', token: 'griffin' },
      { company: 'Lendable', token: 'lendable' },
      { company: 'Gradient Labs', token: 'gradient-labs' },
      { company: 'Taptap Send', token: 'TaptapSend' },
      { company: 'ClearBank', token: 'clearbank' },
      { company: 'iwoca', token: 'iwoca.co.uk' },
      { company: 'Checkout.com', token: 'checkout.com' },
      { company: 'Modulr', token: 'modulr' },
      { company: 'Atom bank', token: 'atom-bank' },
      { company: 'MarketFinance', token: 'marketfinance' },
      { company: 'OakNorth', token: 'oaknorth' },
      { company: 'Shawbrook', token: 'shawbrook' },
      { company: 'Wise', token: 'wise' },
      { company: 'Revolut', token: 'revolut' },
      { company: 'AJ Bell', token: 'aj-bell' },
      { company: 'Hargreaves Lansdown', token: 'hargreaves-lansdown' },
      { company: 'Close Brothers', token: 'close-brothers' }
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
    if (reedApiKey) sourceTasks.push(...keywords.map(keyword => ({ source: 'Reed', promise: searchReed(keyword) })));

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
        if (existing) mergeSource(existing, job); else jobs.push(createJob(job));
      }
    });

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
  const strongTitle = titleTarget || requested || titleRelated;
  if (!strongTitle || !senior || excluded || consulting || disclosedBelowTarget) return false;
  if (!remit && !titleTarget && !requested) return false;
  if (!finance) return false;
  return true;
}

function relevanceScore(job, keywords, minimumSalary) {
  const title = String(job.title || '');
  const text = `${title} ${job.company || ''} ${job.location || ''} ${job.description || ''}`;
  let score = 0;
  if (matchesAny(TARGET_ROLE_PATTERNS, title)) score += 100;
  if (matchesAny(RELATED_ROLE_PATTERNS, title)) score += 65;
  if (requestedTitleMatch(title, keywords)) score += 45;
  if (/\b(strategy|strategic)\b/i.test(title)) score += 12;
  if (/\b(financial services|banking|bank|fintech|payments|lending|regulated)\b/i.test(text)) score += 15;
  if (/\b(target operating model|operating model|transformation|change|continuous improvement|operational excellence)\b/i.test(text)) score += 12;
  if (typeof job.salaryMin === 'number' && minimumSalary > 0 && job.salaryMin >= minimumSalary) score += 10;
  if (/\b(london|uk|united kingdom)\b/i.test(job.location || '')) score += 5;
  return score;
}

function createJob(job) {
  return {
    ...job,
    sources: [job.source].filter(Boolean),
    applyOptions: job.url ? [{ source: job.source, url: job.url }] : []
  };
}

function mergeSource(existing, job) {
  if (job.source && !existing.sources.includes(job.source)) existing.sources.push(job.source);
  if (job.url && !existing.applyOptions.some(option => option.url === job.url)) {
    existing.applyOptions.push({ source: job.source, url: job.url });
  }
  if ((!existing.description || existing.description.length < 160) && job.description) existing.description = job.description;
  if (existing.salary === 'Salary not disclosed' && job.salary && job.salary !== 'Salary not disclosed') existing.salary = job.salary;
  if (typeof existing.salaryMin !== 'number' && typeof job.salaryMin === 'number') existing.salaryMin = job.salaryMin;
  if (typeof existing.salaryMax !== 'number' && typeof job.salaryMax === 'number') existing.salaryMax = job.salaryMax;
  if (!existing.created && job.created) existing.created = job.created;
}

function findMatchingJob(jobs, job) {
  const title = normalise(job.title || '');
  const company = normalise(job.company || '');
  const location = normalise(job.location || '');
  if (!title || !company) return null;
  return jobs.find(existing => {
    const eTitle = normalise(existing.title || '');
    const eCompany = normalise(existing.company || '');
    const eLocation = normalise(existing.location || '');
    if (eCompany !== company) return false;
    if (eTitle === title) return true;
    const titleTokens = new Set(title.split(' ').filter(Boolean));
    const existingTokens = new Set(eTitle.split(' ').filter(Boolean));
    const intersection = [...titleTokens].filter(token => existingTokens.has(token)).length;
    const union = new Set([...titleTokens, ...existingTokens]).size;
    const similarity = union ? intersection / union : 0;
    return similarity >= 0.72 && (!location || !eLocation || location.includes(eLocation) || eLocation.includes(location));
  });
}

function normalise(value) {
  return String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&pound;/gi, '£').replace(/\s+/g, ' ').trim();
}

function formatSalary(min, max) {
  const hasMin = typeof min === 'number' && Number.isFinite(min) && min > 0;
  const hasMax = typeof max === 'number' && Number.isFinite(max) && max > 0;
  if (!hasMin && !hasMax) return 'Salary not disclosed';
  const money = value => `£${Math.round(value).toLocaleString('en-GB')}`;
  if (hasMin && hasMax) return `${money(min)} - ${money(max)}`;
  return money(hasMin ? min : max);
}

function extractSalaryFromText(text) {
  const clean = stripHtml(text);
  const match = clean.match(/£\s*([0-9]{2,3}(?:,[0-9]{3})?|[0-9]{4,6})\s*(?:-|–|to)\s*£?\s*([0-9]{2,3}(?:,[0-9]{3})?|[0-9]{4,6})/i);
  if (!match) return 'Salary not disclosed';
  return `£${match[1]} - £${match[2]}`;
}

module.exports = handler;
