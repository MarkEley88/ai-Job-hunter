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
    'Head of Operations', 'Director of Operations', 'COO',
    'Head of Transformation', 'Transformation Director', 'Head of Change',
    'Head of Business Operations', 'Director of Change', 'Director of Transformation'
  ])].slice(0, 8);

  const senior = /\b(head|director|chief|vp|vice president|managing director|executive director)\b/i;
  const target = /\b(head of operations|director of operations|operations director|chief operating officer|coo|head of transformation|transformation director|head of change|chief transformation officer|head of strategy.{0,25}transformation|head of business operations|head of operational excellence|director of change|director of transformation)\b/i;
  const related = /\b(head of service delivery|head of customer operations|head of operational change|head of continuous improvement|head of operating model|director of service delivery|director of customer operations|director of operational excellence|director of business change|director of change delivery|director of transformation delivery|chief of staff|head of strategy.{0,25}(operations|change|delivery))\b/i;
  const remit = /\b(operations?|operational excellence|operating model|service delivery|customer operations|business operations|process(?:es)?|controls?|servicing|change|transformation|continuous improvement|target operating model)\b/i;
  const finance = /\b(bank|banking|fintech|payments?|lender|lending|financial services?|mortgage|savings|credit|insurance|insurtech|consumer finance|wealth|asset management|regulated)\b/i;
  const excluded = /\b(operations? manager|operations? analyst|operations? coordinator|sales operations|marketing operations|hr operations|people operations|it operations|technical operations|clinical operations|warehouse operations|logistics operations|retail operations|store operations|restaurant operations|property operations|revenue operations)\b/i;
  const consulting = /\b(consultant|consultancy|professional services)\b/i;
  const clearlyWrong = /\b(engineering|software|developer|data scientist|nurse|teacher|legal counsel|solicitor|accountant|audit manager|warehouse|logistics|restaurant|hotel)\b/i;

  const clean = x => String(x || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
  const money = (a,b) => (a || b) ? `£${Number(a || b).toLocaleString()}${b ? ` – £${Number(b).toLocaleString()}` : '+'}` : 'Salary not disclosed';

  const score = j => {
    const title = String(j.title || '');
    const t = `${title} ${j.company || ''} ${j.description || ''}`;
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
    if (/\b(target operating model|operating model|business transformation|operational transformation|change delivery)\b/i.test(t)) s += 8;
    if (Number(j.salaryMax || 0) >= 120000) s += 10;
    else if (Number(j.salaryMin || 0) >= 100000) s += 5;
    if (consulting.test(title)) s -= 15;
    if (excluded.test(title)) s -= 80;
    if (clearlyWrong.test(title)) s -= 50;
    return Math.max(0, Math.min(100, s));
  };

  // Keep senior target/adjacent roles even when the job description does not mention finance.
  // Finance is a ranking signal rather than a hard requirement, because aggregator descriptions are often sparse.
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
    if (!j.title) return;
    const key = `${String(j.company).toLowerCase()}|${String(j.title).toLowerCase()}`;
    const old = results.find(x => `${String(x.company).toLowerCase()}|${String(x.title).toLowerCase()}` === key);
    if (!old) {
      j.applyOptions = j.url ? [{ name: j.source, url: j.url }] : [];
      results.push(j);
    } else if (j.url && !old.applyOptions.some(x => x.url === j.url)) {
      old.applyOptions.push({ name: j.source, url: j.url });
    }
  });

  async function adzuna(term) {
    const p = new URLSearchParams({ app_id: appId, app_key: appKey, results_per_page: '50', what: term, sort_by: 'date' });
    if (where) p.set('where', where);
    const r = await fetch('https://api.adzuna.com/v1/api/jobs/gb/search/1?' + p.toString(), { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`Adzuna ${r.status}`);
    const d = await r.json();
    return (d.results || []).map(x => ({
      title: x.title, company: x.company?.display_name || 'Unknown company', location: x.location?.display_name || 'UK',
      salary: money(x.salary_min, x.salary_max), salaryMin: x.salary_min ?? null, salaryMax: x.salary_max ?? null,
      url: x.redirect_url || '', description: clean(x.description), created: x.created || '', source: 'Adzuna'
    }));
  }

  async function jooble() {
    if (!joobleKey) return [];
    const r = await fetch(`https://uk.jooble.org/api/${encodeURIComponent(joobleKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ keywords: terms.join(', '), location: where || 'London', page: 1, ResultOnPage: 100 })
    });
    if (!r.ok) throw new Error(`Jooble ${r.status}`);
    const d = await r.json();
    return (d.jobs || []).map(x => ({
      title: x.title, company: x.company || 'Unknown company', location: x.location || 'UK', salary: x.salary || 'Salary not disclosed',
      salaryMin: null, salaryMax: null, url: x.link || '', description: clean(x.snippet), created: x.updated || '', source: 'Jooble'
    }));
  }

  async function reed(term) {
    if (!reedKey) return [];
    const p = new URLSearchParams({ keywords: term, resultsToTake: '50' });
    if (where) p.set('locationName', where);
    const auth = Buffer.from(`${reedKey}:`).toString('base64');
    const r = await fetch('https://www.reed.co.uk/api/1.0/search?' + p.toString(), { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
    if (!r.ok) throw new Error(`Reed ${r.status}`);
    const d = await r.json();
    const rows = Array.isArray(d) ? d : d.results || [];
    return rows.map(x => ({
      title: x.jobTitle || x.title, company: x.employerName || x.employer || 'Unknown company', location: x.locationName || x.location || 'UK',
      salary: money(x.minimumSalary, x.maximumSalary), salaryMin: x.minimumSalary ?? null, salaryMax: x.maximumSalary ?? null,
      url: x.jobUrl || x.url || '', description: clean(x.jobDescription || x.description), created: x.datePosted || x.date || '', source: 'Reed'
    }));
  }

  try {
    // Fewer Adzuna/Reed queries reduces rate limiting while retaining broad coverage.
    const tasks = [
      ...terms.map(adzuna),
      jooble(),
      ...(reedKey ? terms.map(reed) : [])
    ];
    const settled = await Promise.allSettled(tasks);
    settled.forEach(x => x.status === 'fulfilled' ? add(x.value) : errors.push(x.reason?.message || String(x.reason)));

    const ranked = results
      .filter(relevant)
      .map(j => ({ ...j, relevanceScore: score(j), fitRationale: 'Matched for senior operations, transformation, change or operating-model leadership; financial-services relevance and salary data increase the score.' }))
      .sort((a,b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 50);

    res.status(200).json({
      count: ranked.length,
      sources: ['Adzuna', joobleKey ? 'Jooble' : null, reedKey ? 'Reed' : null].filter(Boolean),
      sourceErrors: errors,
      jobs: ranked
    });
  } catch (error) {
    res.status(502).json({ error: 'Unable to search job sources.', details: error?.message || String(error) });
  }
}

module.exports = handler;
