(() => {
  // Reliable search: try the newest endpoint first, then fall back to the previous
  // endpoints so a Vercel deployment/API hiccup never leaves the user with a generic error.
  const button = document.querySelector('#find-jobs-button');
  if (!button) return;
  const replacement = button.cloneNode(true);
  button.replaceWith(replacement);

  const API_URLS = [
    'https://ai-job-hunter-vert.vercel.app/api/jobs3',
    'https://ai-job-hunter-vert.vercel.app/api/jobs2',
    'https://ai-job-hunter-vert.vercel.app/api/jobs'
  ];
  const searchStatus = document.querySelector('#search-status');
  const searchResults = document.querySelector('#search-results');
  const statusFilter = document.querySelector('#status-filter');
  const fitFilter = document.querySelector('#fit-filter');

  const broadTitles = [
    'Head of Operations','Director of Operations','Operations Director','Chief Operating Officer','COO',
    'Head of Transformation','Transformation Director','Head of Change','Change Director',
    'Head of Strategy and Transformation','Strategy and Transformation Director','Head of Business Operations',
    'Head of Customer Operations','Head of Operational Excellence','Director of Business Operations',
    'Director of Service Delivery','Director of Change Delivery','Director of Transformation Delivery',
    'Head of Operating Model','Head of Continuous Improvement'
  ];

  function jobsStore() { try { return JSON.parse(localStorage.getItem('ai-job-hunter-jobs-v1')) || []; } catch { return []; } }
  function save(jobs) { localStorage.setItem('ai-job-hunter-jobs-v1', JSON.stringify(jobs)); }
  function norm(v) { return String(v || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function similarity(a,b) { const A=new Set(norm(a).split(' ').filter(Boolean)),B=new Set(norm(b).split(' ').filter(Boolean)); return A.size&&B.size?[...A].filter(x=>B.has(x)).length/new Set([...A,...B]).size:0; }
  function merge(existing,incoming) {
    const result=[...existing];
    incoming.forEach(job=>{
      const found=result.find(item=>norm(item.company)===norm(job.company)&&((job.url&&item.url===job.url)||(norm(item.title)===norm(job.title))||(similarity(item.title,job.title)>=0.8)));
      if(!found){result.push(job);return;}
      const sources=[...(found.applyOptions||found.sources||[])];
      (job.applyOptions||job.sources||(job.url?[{name:job.source||'Source',url:job.url}]:[])).forEach(source=>{if(source?.url&&!sources.some(s=>s.url===source.url))sources.push(source);});
      found.applyOptions=sources;found.sources=sources;
      if(!found.url&&job.url)found.url=job.url;
      if((job.description||'').length>(found.description||'').length)found.description=job.description;
      if(typeof job.relevanceScore==='number'&&job.relevanceScore>(found.relevanceScore||0)){found.relevanceScore=job.relevanceScore;found.score=job.relevanceScore;found.fitRationale=job.fitRationale;}
    });
    return result;
  }

  async function callApi(url, params) {
    const response = await fetch(`${url}?${params.toString()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${url.split('/').pop()} returned HTTP ${response.status}`);
    return response.json();
  }

  replacement.addEventListener('click', async () => {
    const location=document.querySelector('#search-location').value.trim();
    const userKeywords=document.querySelector('#search-keywords').value.split(',').map(x=>x.trim()).filter(Boolean);
    const keywords=[...new Set([...userKeywords,...broadTitles])];
    replacement.disabled=true;
    searchStatus.textContent=`Searching ${keywords.length} leadership title variations across the available sources…`;
    searchResults.replaceChildren();

    const params=new URLSearchParams({keywords:keywords.join(', '),location,minSalary:'0'});
    let data=null;
    const apiErrors=[];

    try {
      for (const apiUrl of API_URLS) {
        try {
          data=await callApi(apiUrl, params);
          if (Array.isArray(data.jobs) && data.jobs.length) break;
          apiErrors.push(`${apiUrl.split('/').pop()}: 0 jobs`);
        } catch (error) {
          apiErrors.push(error.message);
        }
      }

      const jobs=Array.isArray(data?.jobs)?data.jobs:[];
      if (!jobs.length) {
        searchStatus.textContent=`No suitable leadership roles returned. API status: ${apiErrors.join(' | ')}`;
        return;
      }

      const enriched=jobs.map(job=>({...job,id:job.id||`job-${Date.now()}-${Math.random().toString(36).slice(2)}`,status:job.status||'Interested',score:typeof job.relevanceScore==='number'?job.relevanceScore:(job.score||0)}));
      save(merge(jobsStore(),enriched));
      statusFilter.value='all';
      fitFilter.value='all';
      statusFilter.dispatchEvent(new Event('change'));

      const sourceText=Array.isArray(data.sources)?data.sources.join(' + '):'available sources';
      const errors=Array.isArray(data.sourceErrors)&&data.sourceErrors.length?` (${data.sourceErrors.length} source issue${data.sourceErrors.length===1?'':'s'})`:'';
      searchStatus.textContent=`${enriched.length} relevant leadership roles found across ${sourceText}${errors}.`;
    } catch(error) {
      console.error(error);
      searchStatus.textContent=`Search API error: ${error.message}.`;
    } finally {
      replacement.disabled=false;
    }
  });
})();
