async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  const joobleKey = process.env.JOOBLE_API_KEY;
  const reedKey = process.env.REED_API_KEY;
  if (!appId || !appKey) return res.status(500).json({ error: 'Adzuna API credentials are not configured.' });

  const q = req.query || {};
  const requested = String(q.keywords || 'Head of Operations, Head of Transformation, COO')
    .split(',').map(x => x.trim()).filter(Boolean);
  const locationRaw = String(q.location || 'London');
  const where = /uk/i.test(locationRaw) ? 'London' : locationRaw.split('/')[0].trim();

  const terms = [...new Set([
    ...requested,
    'Head of Operations', 'Head of Transformation', 'COO', 'Head of Change'
  ])].slice(0, 4);

  const senior = /\b(head|director|chief|vp|vice president|managing director|executive director)\b/i;
  const target = /\b(head of operations|director of operations|operations director|chief operating officer|coo|head of transformation|transformation director|head of change|change director|chief transformation officer|head of strategy.{0,25}transformation|head of business operations|head of operational excellence|director of change|director of transformation|head of operational development|director of operational development|head of operating model)\b/i;
  const related = /\b(head of service delivery|head of customer operations|head of operational change|head of continuous improvement|head of operating model|director of service delivery|director of customer operations|director of operational excellence|director of business change|director of change delivery|director of transformation delivery|chief of staff|head of strategy.{0,25}(operations|change|delivery))\b/i;
  const remit = /\b(operations?|operational excellence|operating model|service delivery|customer operations|business operations|process(?:es)?|controls?|servicing|change|transformation|continuous improvement|target operating model|operational resilience)\b/i;
  const finance = /\b(bank|banking|fintech|payments?|lender|lending|financial services?|mortgage|savings|credit|insurance|insurtech|consumer finance|wealth|asset management|regulated|building society)\b/i;
  const excluded = /\b(operations? manager|operations? analyst|operations? coordinator|sales operations|marketing operations|hr operations|people operations|it operations|technical operations|clinical operations|warehouse operations|logistics operations|retail operations|store operations|restaurant operations|property operations|revenue operations)\b/i;
  const consulting = /\b(consultant|consultancy|professional services)\b/i;
  const clearlyWrong = /\b(engineering|software|developer|data scientist|nurse|teacher|legal counsel|solicitor|accountant|audit manager|warehouse|logistics|restaurant|hotel)\b/i;

  const clean = x => String(x || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;/gi, "'").replace(/\s+/g, ' ').trim();
  const money = (a,b) => (a || b) ? `£${Number(a || b).toLocaleString()}${b ? ` – £${Number(b).toLocaleString()}` : '+'}` : 'Salary not disclosed';

  const score = j => {
    const title = String(j.title || '');
    const description = String(j.description || '');
    const t = `${title} ${j.company || ''} ${description}`;
    let s = 0;
    if (target.test(title)) s += 60;
    else if (related.test(title)) s += 45;
    else if (senior.test(title) && remit.test(title)) s += 32;
    if (senior.test(title)) s += 15;
    if (finance.test(title)) s += 18;
    else if (finance.test(t)) s += 10;
    if (remit.test(title)) s += 12;
    else if (remit.test(t)) s += 6;
    if (/\b(london|city of london|uk|united kingdom|england|hybrid|remote)\b/i.test(t)) s += 4;
    if (/\b(target operating model|operating model|business transformation|operational transformation|change delivery|operational resilience)\b/i.test(t)) s += 8;
    if (/\b(coo|chief operating officer|reporting to the coo|reports to the coo)\b/i.test(t)) s += 7;
    if (/\b(regulatory|pra|fca|consumer duty|regulated bank|regulated lender)\b/i.test(t)) s += 5;
    if (/\b(process improvement|process optimisation|automation|customer journey|continuous improvement)\b/i.test(t)) s += 4;
    if (Number(j.salaryMax || 0) >= 120000) s += 10;
    else if (Number(j.salaryMin || 0) >= 100000) s += 5;
    if (j.directCompany) s += 8;
    if (consulting.test(title)) s -= 15;
    if (excluded.test(title)) s -= 80;
    if (clearlyWrong.test(title)) s -= 50;
    return Math.max(0, Math.min(100, s));
  };

  const relevant = j => {
    const title = String(j.title || '');
    const t = `${title} ${j.description || ''}`;
    if (!senior.test(title)) return false;
    if (excluded.test(title) || clearlyWrong.test(title)) return false;
    if (target.test(title) || related.test(title)) return true;
    return remit.test(title) && finance.test(t) && !consulting.test(title);
  };

  const results = [];
  const errors = [];
  const add = rows => rows.forEach(j => {
    if (!j || !j.title) return;
    const key = `${String(j.company).toLowerCase()}|${String(j.title).toLowerCase()}`;
    const old = results.find(x => `${String(x.company).toLowerCase()}|${String(x.title).toLowerCase()}` === key);
    if (!old) {
      j.applyOptions = j.url ? [{ name: j.source, url: j.url }] : [];
      results.push(j);
    } else if (j.url && !old.applyOptions.some(x => x.url === j.url)) {
      old.applyOptions.push({ name: j.source, url: j.url });
      if (j.directCompany) old.directCompany = true;
    }
  });

  async function readJson(r, source) {
    const text = await r.text();
    if (!r.ok) throw new Error(`${source} ${r.status}`);
    try { return JSON.parse(text); }
    catch { throw new Error(`${source} returned non-JSON (${r.status})`); }
  }

  async function adzuna(term) {
    const p = new URLSearchParams({ app_id: appId, app_key: appKey, results_per_page: '50', what: term, sort_by: 'date' });
    if (where) p.set('where', where);
    const r = await fetch('https://api.adzuna.com/v1/api/jobs/gb/search/1?' + p.toString(), { headers: { Accept: 'application/json' } });
    const d = await readJson(r, 'Adzuna');
    return (d.results || []).map(x => ({ title: x.title, company: x.company?.display_name || 'Unknown company', location: x.location?.display_name || 'UK', salary: money(x.salary_min, x.salary_max), salaryMin: x.salary_min ?? null, salaryMax: x.salary_max ?? null, url: x.redirect_url || '', description: clean(x.description), created: x.created || '', source: 'Adzuna' }));
  }

  async function jooble() {
    if (!joobleKey) return [];
    const r = await fetch(`https://uk.jooble.org/api/${encodeURIComponent(joobleKey)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ keywords: terms.join(', '), location: where || 'London', page: 1, ResultOnPage: 100 }) });
    const d = await readJson(r, 'Jooble');
    return (d.jobs || []).map(x => ({ title: x.title, company: x.company || 'Unknown company', location: x.location || 'UK', salary: x.salary || 'Salary not disclosed', salaryMin: null, salaryMax: null, url: x.link || '', description: clean(x.snippet), created: x.updated || '', source: 'Jooble' }));
  }

  async function reed(term) {
    if (!reedKey) return [];
    const p = new URLSearchParams({ keywords: term, resultsToTake: '50' });
    if (where) p.set('locationName', where);
    const auth = Buffer.from(`${reedKey}:`).toString('base64');
    const r = await fetch('https://www.reed.co.uk/api/1.0/search?' + p.toString(), { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
    const d = await readJson(r, 'Reed');
    const rows = Array.isArray(d) ? d : d.results || [];
    return rows.map(x => ({ title: x.jobTitle || x.title, company: x.employerName || x.employer || 'Unknown company', location: x.locationName || x.location || 'UK', salary: money(x.minimumSalary, x.maximumSalary), salaryMin: x.minimumSalary ?? null, salaryMax: x.maximumSalary ?? null, url: x.jobUrl || x.url || '', description: clean(x.jobDescription || x.description), created: x.datePosted || x.date || '', source: 'Reed' }));
  }

  // Direct employer boards. This deliberately uses public ATS endpoints only: no employer
  // credentials are required and application links stay with the employer/ATS.
  // The list is intentionally broad so the app is not dependent on aggregators for discovery.
  const directBoards = [
    { company: 'Monzo', ats: 'greenhouse', slug: 'monzo' },
    { company: 'Tide', ats: 'greenhouse', slug: 'tide' },
    { company: 'Capital on Tap', ats: 'greenhouse', slug: 'capitalontap' },
    { company: 'iwoca', ats: 'ashby', slug: 'iwoca.co.uk' },
    { company: 'Allica Bank', ats: 'ashby', slug: 'allica-bank' },
    { company: 'Zopa', ats: 'lever', slug: 'zopa' },
    { company: 'Starling Bank', ats: 'workable', slug: 'starling-bank' },
    { company: 'Wise', ats: 'smartrecruiters', slug: 'Wise' },
    { company: 'Checkout.com', ats: 'greenhouse', slug: 'checkoutcom' },
    { company: 'GoCardless', ats: 'greenhouse', slug: 'gocardless' },
    { company: 'Funding Circle', ats: 'greenhouse', slug: 'fundingcircle' },
    { company: 'OakNorth', ats: 'greenhouse', slug: 'oaknorth' },
    { company: 'SumUp', ats: 'greenhouse', slug: 'sumup' },
    { company: 'Stripe', ats: 'greenhouse', slug: 'stripe' },
    { company: 'Adyen', ats: 'greenhouse', slug: 'adyen' },
    { company: 'Mollie', ats: 'greenhouse', slug: 'mollie' },
    { company: 'Form3', ats: 'greenhouse', slug: 'form3' },
    { company: 'Moneybox', ats: 'greenhouse', slug: 'moneybox' },
    { company: 'Freetrade', ats: 'greenhouse', slug: 'freetrade' },
    { company: 'Hargreaves Lansdown', ats: 'greenhouse', slug: 'hargreaveslansdown' },
    { company: 'Revolut', ats: 'greenhouse', slug: 'revolut' },
    { company: 'NewDay', ats: 'greenhouse', slug: 'newday' },
    { company: 'ClearBank', ats: 'greenhouse', slug: 'clearbank' },
    { company: 'Shawbrook', ats: 'greenhouse', slug: 'shawbrook' }
  ];

  const directTitle = /\b(head|director|chief|vp|vice president|managing director|executive director)\b/i;
  const directKeyword = /(operations?|transformation|change|operating model|service delivery|customer operations|operational excellence|business operations|continuous improvement|resilience)/i;
  const directFinance = /(bank|banking|fintech|payments?|lending|credit|financial services?|regulated|mortgage|savings|wealth|asset management)/i;

  async function greenhouse(board) {
    const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.slug)}/jobs?content=true`, { headers: { Accept: 'application/json' } });
    const d = await readJson(r, `Direct:${board.company}`);
    return (d.jobs || []).map(x => ({ title: x.title, company: board.company, location: x.location?.name || 'UK', salary: 'Salary not disclosed', salaryMin: null, salaryMax: null, url: x.absolute_url || '', description: clean(x.content), created: x.updated_at || '', source: `Direct - ${board.company}`, directCompany: true }));
  }

  async function ashby(board) {
    const r = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board.slug)}?includeCompensation=true`, { headers: { Accept: 'application/json' } });
    const d = await readJson(r, `Direct:${board.company}`);
    return (d.jobs || []).map(x => ({ title: x.title, company: board.company, location: x.location || (x.locationNames || []).join(', ') || 'UK', salary: x.compensation?.scrapeableCompensationSalarySummary || 'Salary not disclosed', salaryMin: null, salaryMax: null, url: x.jobUrl || x.applyUrl || '', description: clean(x.descriptionPlain || x.description || ''), created: x.publishedAt || '', source: `Direct - ${board.company}`, directCompany: true }));
  }

  async function lever(board) {
    const r = await fetch(`https://api.lever.co/v0/postings/${encodeURIComponent(board.slug)}?mode=json`, { headers: { Accept: 'application/json' } });
    const d = await readJson(r, `Direct:${board.company}`);
    return (Array.isArray(d) ? d : []).map(x => ({ title: x.text, company: board.company, location: x.categories?.location || (x.categories?.allLocations || []).join(', ') || 'UK', salary: x.salaryRange ? `${x.salaryRange.currency || '£'}${x.salaryRange.min || ''} – ${x.salaryRange.max || ''}` : 'Salary not disclosed', salaryMin: x.salaryRange?.min ?? null, salaryMax: x.salaryRange?.max ?? null, url: x.hostedUrl || x.applyUrl || '', description: clean(x.descriptionPlain || x.description || ''), created: x.createdAt ? new Date(x.createdAt).toISOString() : '', source: `Direct - ${board.company}`, directCompany: true }));
  }

  async function workable(board) {
    const r = await fetch(`https://apply.workable.com/api/v3/accounts/${encodeURIComponent(board.slug)}/jobs?limit=100`, { headers: { Accept: 'application/json' } });
    const d = await readJson(r, `Direct:${board.company}`);
    return (d.results || d.jobs || []).map(x => ({ title: x.title, company: board.company, location: x.location?.location_str || x.location?.city || 'UK', salary: x.salary?.salary_from ? `${x.salary.salary_currency || '£'}${x.salary.salary_from} – ${x.salary.salary_to || ''}` : 'Salary not disclosed', salaryMin: x.salary?.salary_from ?? null, salaryMax: x.salary?.salary_to ?? null, url: x.url || x.shortlink || '', description: clean(x.description || x.full_description || ''), created: x.created_at || '', source: `Direct - ${board.company}`, directCompany: true }));
  }

  async function smartrecruiters(board) {
    const r = await fetch(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(board.slug)}/postings?limit=100`, { headers: { Accept: 'application/json' } });
    const d = await readJson(r, `Direct:${board.company}`);
    return (d.content || []).map(x => ({ title: x.name, company: board.company, location: x.location?.city || x.location?.region || x.location?.country || 'UK', salary: 'Salary not disclosed', salaryMin: null, salaryMax: null, url: x.ref || '', description: clean(x.jobAd?.sections?.jobDescription?.text || ''), created: x.releasedDate || '', source: `Direct - ${board.company}`, directCompany: true }));
  }

  async function directEmployerJobs() {
    const rows = [];
    for (const board of directBoards) {
      try {
        let jobs = [];
        if (board.ats === 'greenhouse') jobs = await greenhouse(board);
        else if (board.ats === 'ashby') jobs = await ashby(board);
        else if (board.ats === 'lever') jobs = await lever(board);
        else if (board.ats === 'workable') jobs = await workable(board);
        else if (board.ats === 'smartrecruiters') jobs = await smartrecruiters(board);
        rows.push(...jobs.filter(j => {
          const text = `${j.title} ${j.location} ${j.description}`;
          const uk = /\b(london|uk|united kingdom|england|remote - united kingdom|remote, uk)\b/i.test(text);
          return directTitle.test(j.title) && directKeyword.test(text) && (uk || directFinance.test(text));
        }));
      } catch (e) {
        errors.push(e?.message || String(e));
      }
    }
    return rows;
  }

  try {
    for (const term of terms) {
      try { add(await adzuna(term)); } catch (e) { errors.push(e?.message || String(e)); }
    }
    try { add(await jooble()); } catch (e) { errors.push(e?.message || String(e)); }
    if (reedKey) {
      try { add(await reed('Head of Operations OR Head of Transformation OR COO')); } catch (e) { errors.push(e?.message || String(e)); }
    }
    add(await directEmployerJobs());

    const ranked = results
      .filter(relevant)
      .map(j => ({ ...j, relevanceScore: score(j), fitRationale: 'Matched for senior operations, transformation, change or operating-model leadership; direct employer postings, financial-services relevance, regulatory remit and salary data increase the score.' }))
      .sort((a,b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 50);

    const sourceList = ['Adzuna', joobleKey ? 'Jooble' : null, reedKey ? 'Reed' : null, ranked.some(j => j.directCompany) ? 'Direct company career sites' : null].filter(Boolean);
    res.status(200).json({ count: ranked.length, sources: sourceList, sourceErrors: errors, jobs: ranked });
  } catch (error) {
    res.status(502).json({ error: 'Unable to search job sources.', details: error?.message || String(error) });
  }
}

module.exports = handler;
