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
  if (!appId || !appKey) return res.status(500).json({ error: 'Adzuna API credentials are not configured on the server.' });

  const q = req.query || {};
  const requested = [...new Set(String(q.keywords || 'Head of Operations, Head of Transformation, COO').split(',').map(x => x.trim()).filter(Boolean))];
  const location = String(q.location || 'London').trim();
  const minimumSalary = Number(q.minSalary ?? q.salary ?? 0) || 0;
  let where = location;
  if (/^(uk|united kingdom)$/i.test(where) || /uk\s*\/\s*london\s*\/\s*hybrid/i.test(where)) where = 'London';
  if (where) where = where.split('/')[0].trim();

  const roleSearchTerms = [...new Set([...requested, 'Head of Operations', 'Director of Operations', 'COO', 'Head of Transformation', 'Transformation Director', 'Head of Change', 'Head of Business Operations'])].slice(0, 8);
  const TARGET = [/\\bhead of operations\\b/i,/\\bdirector of operations\\b/i,/\\boperations director\\b/i,/\\bchief operating officer\\b/i,/\\b\\bcoo\\b/i,/\\bhead of transformation\\b/i,/\\btransformation director\\b/i,/\\bhead of change\\b/i,/\\bchief transformation officer\\b/i,/\\bhead of strategy.*transformation\\b/i,/\\boperations.*transformation director\\b/i,/\\bdirector of business operations\\b/i,/\\bhead of operational excellence\\b/i,/\\bhead of business operations\\b/i];
  const RELATED = [/\\bhead of service delivery\\b/i,/\\bhead of customer operations\\b/i,/\\bhead of operational change\\b/i,/\\bhead of continuous improvement\\b/i,/\\bhead of operating model\\b/i,/\\bdirector of service delivery\\b/i,/\\bdirector of customer operations\\b/i,/\\bdirector of operational excellence\\b/i,/\\bdirector of business change\\b/i,/\\bdirector of change delivery\\b/i,/\\bdirector of transformation delivery\\b/i,/\\bchief of staff\\b.*\\boperations\\b/i];
  const SENIOR = /\\b(head|director|chief|vp|vice president|managing director|executive director)\\b/i;
  const FINANCE = /\\b(bank|banking|fintech|payments?|lender|lending|financial services?|mortgage|savings|credit|insurance|insurtech|consumer finance|wealth|asset management|regulated)\\b/i;
  const REMIT = /\\b(operations?|operational excellence|operating model|service delivery|customer operations|business operations|process(?:es)?|controls?|servicing|change|transformation|continuous improvement|target operating model)\\b/i;
  const EXCLUDED = /\\b(operations? manager|operations? analyst|operations? coordinator|sales operations|marketing operations|hr operations|people operations|it operations|technical operations|clinical operations|warehouse operations|logistics operations|retail operations|store operations|restaurant operations|property operations|revenue operations|commercial operations)\\b/i;
  const CONSULTING = /\\b(consultant|consultancy|advisory|professional services)\\b/i;
  const normalise = x => String(x || '').toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,' ').replace(/\\s+/g,' ').trim();
  const stripHtml = x => String(x || '').replace(/<[^>]*>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/\\s+/g,' ').trim();
  const formatSalary = (min,max) => min || max ? `£${Number(min || max).toLocaleString()}${max ? ` – £${Number(max).toLocaleString()}` : '+'}` : 'Salary not disclosed';
  const extractSalary = text => { const m = String(text || '').match(/£\\s?([0-9]{2,3}(?:,[0-9]{3})?)(?:\\s?[-–to]+\\s?£?\\s?([0-9]{2,3}(?:,[0-9]{3})?))?/i); return m ? `£${m[1]}${m[2] ? ` – £${m[2]}` : ''}` : 'Salary not disclosed'; };
  const titleTarget = t => TARGET.some(r => r.test(t));
  const titleRelated = t => RELATED.some(r => r.test(t));
  const score = job => {
    const title = String(job.title || ''); const text = `${title} ${job.company || ''} ${job.description || ''}`;
    let s = 0;
    if (titleTarget(title)) s += 45; else if (titleRelated(title)) s += 34;
    if (SENIOR.test(title)) s += 20;
    if (FINANCE.test(text)) s += 15;
    if (REMIT.test(text)) s += 12;
    if (minimumSalary > 0 && typeof job.salaryMin === 'number') s += job.salaryMin >= minimumSalary ? 8 : -10;
    else s += 3;
    if (/\\b(london|uk|united kingdom|england|hybrid|remote)\\b/i.test(text)) s += 5;
    if (CONSULTING.test(title)) s -= 18;
    if (EXCLUDED.test(title)) s -= 60;
    return Math.max(0, Math.min(100, s));
  };
  const relevant = job => {
    const title = String(job.title || ''); const text = `${title} ${job.company || ''} ${job.description || ''}`;
    return SENIOR.test(title) && !EXCLUDED.test(title) && !CONSULTING.test(title) && (titleTarget(title) || titleRelated(title) || (REMIT.test(title) && FINANCE.test(text)));
  };
  const mergeKey = j => `${normalise(j.company)}|${normalise(j.title)}`;

  async function adzuna(keyword) {
    const p = new URLSearchParams({app_id:appId,app_key:appKey,results_per_page:'30',what:keyword,sort_by:'date'});
    if (where) p.set('where',where);
    const r = await fetch('https://api.adzuna.com/v1/api/jobs/gb/search/1?' + p, {headers:{Accept:'application/json'}});
    const d = await r.json(); if (!r.ok) throw new Error(`Adzuna ${r.status}`);
    return (d.results || []).map(j => ({title:j.title,company:j.company?.display_name || 'Unknown company',location:j.location?.display_name || 'UK',salary:formatSalary(j.salary_min,j.salary_max),salaryMin:typeof j.salary_min==='number'?j.salary_min:null,salaryMax:typeof j.salary_max==='number'?j.salary_max:null,url:j.redirect_url || '',description:stripHtml(j.description),created:j.created || '',source:'Adzuna'}));
  }
  async function jooble() {
    if (!joobleApiKey) return [];
    const r = await fetch(`https://uk.jooble.org/api/${encodeURIComponent(joobleApiKey)}`,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({keywords:roleSearchTerms.join(', '),location:where || 'London',page:1,ResultOnPage:50,companysearch:false})});
    const d = await r.json(); if (!r.ok) throw new Error(`Jooble ${r.status}`);
    return (d.jobs || []).map(j => ({title:j.title,company:j.company || 'Unknown company',location:j.location || 'UK',salary:j.salary || 'Salary not disclosed',salaryMin:null,salaryMax:null,url:j.link || '',description:stripHtml(j.snippet),created:j.updated || '',source:'Jooble'}));
  }
  async function reed(keyword) {
    if (!reedApiKey) return [];
    const p = new URLSearchParams({keywords:keyword,resultsToTake:'30'}); if (where) p.set('locationName',where);
    const auth = Buffer.from(`${reedApiKey}:`).toString('base64');
    const r = await fetch('https://www.reed.co.uk/api/1.0/search?' + p,{headers:{Accept:'application/json',Authorization:`Basic ${auth}`}});
    const d = await r.json(); if (!r.ok) throw new Error(`Reed ${r.status}`); const rows = Array.isArray(d) ? d : d.results || [];
    return rows.map(j => ({title:j.jobTitle || j.title,company:j.employerName || j.employer || 'Unknown company',location:j.locationName || j.location || 'UK',salary:formatSalary(j.minimumSalary,j.maximumSalary),salaryMin:typeof j.minimumSalary==='number'?j.minimumSalary:null,salaryMax:typeof j.maximumSalary==='number'?j.maximumSalary:null,url:j.jobUrl || j.url || `https://www.reed.co.uk/jobs/${j.jobId || j.id}`,description:stripHtml(j.jobDescription || j.description),created:j.datePosted || j.date || '',source:'Reed'}));
  }

  const boards = [
    ['Tide','https://boards-api.greenhouse.io/v1/boards/tide/jobs?content=true','greenhouse'],['Monzo','https://boards-api.greenhouse.io/v1/boards/monzo/jobs?content=true','greenhouse'],['GoCardless','https://boards-api.greenhouse.io/v1/boards/gocardless/jobs?content=true','greenhouse'],['Zopa','https://api.lever.co/v0/postings/zopa?mode=json','lever'],['Starling Bank','https://api.lever.co/v0/postings/starlingbank?mode=json','lever'],['Allica Bank','https://api.ashbyhq.com/posting-api/job-board/allica-bank?includeCompensation=true','ashby'],['Funding Circle','https://api.ashbyhq.com/posting-api/job-board/fundingcircle?includeCompensation=true','ashby'],['Griffin','https://api.ashbyhq.com/posting-api/job-board/griffin?includeCompensation=true','ashby'],['Lendable','https://api.ashbyhq.com/posting-api/job-board/lendable?includeCompensation=true','ashby'],['ClearBank','https://api.ashbyhq.com/posting-api/job-board/clearbank?includeCompensation=true','ashby'],['iwoca','https://api.ashbyhq.com/posting-api/job-board/iwoca.co.uk?includeCompensation=true','ashby'],['Modulr','https://api.ashbyhq.com/posting-api/job-board/modulr?includeCompensation=true','ashby'],['Atom bank','https://api.ashbyhq.com/posting-api/job-board/atom-bank?includeCompensation=true','ashby'],['MarketFinance','https://api.ashbyhq.com/posting-api/job-board/marketfinance?includeCompensation=true','ashby'],['OakNorth','https://api.ashbyhq.com/posting-api/job-board/oaknorth?includeCompensation=true','ashby'],['Shawbrook','https://api.ashbyhq.com/posting-api/job-board/shawbrook?includeCompensation=true','ashby'],['Wise','https://api.ashbyhq.com/posting-api/job-board/wise?includeCompensation=true','ashby'],['Revolut','https://api.ashbyhq.com/posting-api/job-board/revolut?includeCompensation=true','ashby']
  ];
  async function direct(board) {
    const [company,url,type]=board; const r=await fetch(url,{headers:{Accept:'application/json'}}); if(!r.ok)return [];
    const d=await r.json(); let rows=[];
    if(type==='greenhouse') rows=(d.jobs||[]).map(j=>({title:j.title,company,location:j.location?.name||'UK',salary:extractSalary(j.content),salaryMin:null,salaryMax:null,url:j.absolute_url||'',description:stripHtml(j.content),created:j.updated_at||'',source:`Direct - ${company}`}));
    else if(type==='lever') rows=(Array.isArray(d)?d:[]).map(j=>({title:j.text,company,location:j.categories?.location||'UK',salary:j.salaryRange?formatSalary(j.salaryRange.min,j.salaryRange.max):'Salary not disclosed',salaryMin:typeof j.salaryRange?.min==='number'?j.salaryRange.min:null,salaryMax:typeof j.salaryRange?.max==='number'?j.salaryRange.max:null,url:j.hostedUrl||j.applyUrl||'',description:stripHtml(j.descriptionPlain||j.description),created:j.createdAt?new Date(j.createdAt).toISOString():'',source:`Direct - ${company}`}));
    else rows=(d.jobs||[]).map(j=>{const c=j.compensation?.summaryComponents||[];const sc=c.find(x=>x.compensationType==='Salary');return {title:j.title,company,location:j.location||'UK',salary:sc?formatSalary(sc.minValue,sc.maxValue):'Salary not disclosed',salaryMin:typeof sc?.minValue==='number'?sc.minValue:null,salaryMax:typeof sc?.maxValue==='number'?sc.maxValue:null,url:j.jobUrl||j.applyUrl||'',description:stripHtml(j.description||j.summary),created:'',source:`Direct - ${company}`};});
    return rows;
  }

  try {
    const tasks=[...roleSearchTerms.map(k=>adzuna(k)),jooble(),...(reedApiKey?roleSearchTerms.map(k=>reed(k)):[]),...boards.map(direct)];
    const settled=await Promise.allSettled(tasks); const all=[]; const errors=[];
    settled.forEach((x,i)=>{if(x.status==='rejected'){errors.push(x.reason?.message||String(x.reason));return;} x.value.forEach(j=>{const k=mergeKey(j);const old=all.find(x=>mergeKey(x)===k);if(old){if(j.url&&!old.applyOptions?.some(o=>o.url===j.url)){old.applyOptions=old.applyOptions||[{name:old.source,url:old.url}];old.applyOptions.push({name:j.source,url:j.url});} if((j.description||'').length>(old.description||'').length)old.description=j.description;}else{j.applyOptions=j.url?[{name:j.source,url:j.url}]:[];all.push(j);}});});
    const ranked=all.filter(relevant).map(j=>({...j,relevanceScore:score(j),fitRationale:score(j)>=80?'Very close alignment with the target senior operations/transformation profile.':score(j)>=65?'Strong alignment with the target senior operations/transformation profile.':'Relevant senior operations/transformation role; review the remit and package.'})).sort((a,b)=>b.relevanceScore-a.relevanceScore).slice(0,30);
    const sources=['Adzuna','Direct employer ATS']; if(joobleApiKey)sources.push('Jooble'); if(reedApiKey)sources.push('Reed');
    res.status(200).json({count:ranked.length,sources,sourceErrors:errors,jobs:ranked});
  } catch(e) { res.status(502).json({error:'Unable to search job sources.',details:e?.message||String(e)}); }
}
module.exports = handler;
