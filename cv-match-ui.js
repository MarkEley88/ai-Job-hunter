/* Free CV matching: all analysis happens locally in the browser. No API calls. */
(() => {
  const CV_KEY = 'ai-job-hunter-cv-v1';
  const JOBS_KEY = 'ai-job-hunter-jobs-v1';
  const MIN_REQUIREMENTS = 5;
  const MAX_REQUIREMENTS = 14;
  const STOP = new Set('the and for with that this from your you are our their they will have has into about role job team across including required desirable ability able experience knowledge skills strong excellent working work lead leading manage managing responsible responsibilities'.split(' '));
  const SYNONYMS = {
    operations:['operations','operational','operating'], transformation:['transformation','transformational'], change:['change','business change','change delivery'], strategy:['strategy','strategic'], leadership:['leadership','leader','leading','head','director'], governance:['governance','controls','control framework'], regulatory:['regulatory','regulated','regulation','pra','fca','consumer duty'], financial:['financial services','banking','bank','fintech','payments','lending','lender'], process:['process','processes','process improvement','process optimisation','process optimization'], customer:['customer','customers','client','clients','customer journey'], delivery:['delivery','delivered','programme delivery','program delivery','project delivery'], operatingmodel:['operating model','target operating model','tom'], resilience:['resilience','operational resilience','business continuity'], risk:['risk','risk management','risk appetite'], compliance:['compliance','compliant'], automation:['automation','automate','automated'], continuous:['continuous improvement'], stakeholder:['stakeholder','stakeholders','stakeholder management'], portfolio:['portfolio','change portfolio','programme portfolio'], controls:['controls','control','internal controls'], efficiency:['efficiency','efficient','cost reduction','cost efficiency'], agile:['agile','scrum','kanban'], data:['data','analytics','reporting','management information'], technology:['technology','digital','systems','technology change'], servicing:['servicing','customer servicing'], people:['people','team','teams','talent','coaching']
  };
  const display = { operatingmodel:'operating model', financial:'financial services', stakeholder:'stakeholder management' };
  function readCV(){ return localStorage.getItem(CV_KEY)||''; }
  function saveCV(v){ localStorage.setItem(CV_KEY,v.trim()); }
  function getJobs(){ try{return JSON.parse(localStorage.getItem(JOBS_KEY))||[];}catch{return [];} }
  function saveJobs(v){localStorage.setItem(JOBS_KEY,JSON.stringify(v));}
  function norm(v){return String(v||'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9+.#/-]+/g,' ').replace(/\s+/g,' ').trim();}
  function tokens(v){return norm(v).split(' ').filter(x=>x.length>2&&!STOP.has(x));}
  function hasConcept(text,c){const h=norm(text);return (SYNONYMS[c]||[c]).some(t=>h.includes(norm(t)));}
  function overlap(a,b){const A=new Set(tokens(a)),B=new Set(tokens(b));if(!A.size||!B.size)return 0;return [...A].filter(x=>B.has(x)).length/Math.max(A.size,B.size);}
  function extract(text){
    const raw=String(text||'').replace(/\r/g,'');
    const lines=raw.split(/\n+/).map(x=>x.replace(/^\s*(?:[-•*▪◦]|\d+[.)])\s*/,'').trim()).filter(x=>x.length>=28&&x.length<=260);
    const sentences=raw.split(/(?<=[.!?])\s+/).map(x=>x.trim()).filter(x=>x.length>=35&&x.length<=280);
    const signal=/\b(experience|experienced|knowledge|understanding|ability|able|proven|track record|lead|leading|manage|management|deliver|delivery|responsible|responsibility|required|must|should|skills?|expertise|qualification|degree|regulatory|operational|transformation|change|governance|controls?|stakeholder|process|customer|resilience|strategy|financial services|banking|fintech|payments?|lending|operating model)\b/i;
    const scored=[...lines,...sentences].map(text=>({text:text.replace(/\s+/g,' ').trim(),score:signal.test(text)?2:0})).filter(x=>x.score>=2);
    const unique=[];for(const item of scored){if(unique.some(x=>norm(x.text)===norm(item.text)||overlap(x.text,item.text)>.72))continue;unique.push(item);}
    if(unique.length<MIN_REQUIREMENTS){['operations','transformation','change','leadership','strategy','governance','regulatory','financial','process','customer','delivery','operatingmodel','resilience','risk','stakeholder'].forEach(c=>{if(unique.length<MIN_REQUIREMENTS&&hasConcept(raw,c))unique.push({text:`Experience in ${display[c]||c}.`,score:2});});}
    return unique.slice(0,MAX_REQUIREMENTS);
  }
  function scoreReq(req,cv){
    const r=norm(req.text), c=norm(cv), ts=tokens(req.text).filter(x=>x.length>3); const direct=ts.filter(t=>c.includes(t)).length;
    const concepts=Object.keys(SYNONYMS).filter(k=>hasConcept(req.text,k)); const hits=concepts.filter(k=>hasConcept(cv,k)).length;
    const phrase=concepts.some(k=>SYNONYMS[k].some(t=>r.includes(norm(t))&&c.includes(norm(t)))); const ov=overlap(req.text,cv); const ratio=ts.length?direct/Math.min(ts.length,8):0;
    const matched=phrase||hits>=2||ratio>=.42||ov>=.34, partial=!matched&&(hits>=1||ratio>=.22||ov>=.2);
    return {status:matched?'matched':partial?'partial':'missing'};
  }
  function matchJob(job){
    const cv=readCV();if(!cv.trim())return null; const text=[job.title,job.company,job.description,job.location].filter(Boolean).join('\n'); const reqs=extract(text); if(!reqs.length)return {score:0,matched:0,partial:0,missing:0,total:0,requirements:[]};
    const results=reqs.map(r=>({...r,...scoreReq(r,cv)})); const matched=results.filter(r=>r.status==='matched').length, partial=results.filter(r=>r.status==='partial').length, missing=results.filter(r=>r.status==='missing').length;
    return {score:Math.round(((matched+partial*.5)/results.length)*100),matched,partial,missing,total:results.length,requirements:results,updatedAt:Date.now()};
  }
  function esc(v){return String(v||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function updateAll(){if(!readCV().trim())return;const list=getJobs();list.forEach(j=>j.cvMatch=matchJob(j));saveJobs(list);}
  function breakdown(job){const r=job.cvMatch||matchJob(job);if(!r)return;document.querySelector('#cv-breakdown-modal')?.remove();const d=document.createElement('dialog');d.id='cv-breakdown-modal';d.className='modal cv-breakdown-modal';d.innerHTML=`<div class="modal-header"><div><p class="eyebrow">Free local CV analysis</p><h2>${esc(job.title)}</h2><p class="company">${esc(job.company)}</p></div><button class="icon-button" type="button" data-cv-close>×</button></div><div class="cv-score-hero"><strong>${r.score}%</strong><span>${r.matched}/${r.total} requirements matched</span><small>${r.partial} partial · ${r.missing} not evidenced</small></div><p class="cv-summary">This comparison runs entirely in your browser. It uses requirement extraction plus keyword/concept matching; it does not send your CV or job advert to an external AI service.</p><section><h3>Requirement breakdown</h3>${r.requirements.map(x=>`<div class="requirement-row ${x.status}"><strong>${x.status==='matched'?'✓ Matched':x.status==='partial'?'≈ Partial':'○ Not evidenced'}</strong><p>${esc(x.text)}</p></div>`).join('')}</section><div class="modal-actions"><button class="btn btn-primary" type="button" data-cv-close>Close</button></div>`;document.body.appendChild(d);d.showModal();d.querySelectorAll('[data-cv-close]').forEach(b=>b.onclick=()=>d.close());}
  function render(){const list=getJobs();document.querySelectorAll('.job-card').forEach(card=>{const title=card.querySelector('h3')?.textContent||'',company=card.querySelector('.company')?.textContent||'',job=list.find(j=>String(j.title||'')===title&&String(j.company||'')===company);if(!job)return;const badge=card.querySelector('.cv-match-badge'),summary=card.querySelector('.cv-match-summary'),button=card.querySelector('.score-cv');if(!readCV().trim()){badge.hidden=true;summary.hidden=true;button.textContent='📄 Score against CV';return;}job.cvMatch=job.cvMatch||matchJob(job);const r=job.cvMatch;badge.hidden=false;badge.className=`cv-match-badge ${r.score>=75?'high':r.score>=50?'medium':'low'}`;badge.textContent=`📄 CV ${r.score}%`;summary.hidden=false;summary.innerHTML=`<strong>${r.matched}/${r.total} requirements matched</strong><span>${r.partial} partial · ${r.missing} not evidenced</span><button type="button" class="view-cv-match">View breakdown</button>`;summary.querySelector('button').onclick=()=>breakdown(job);button.textContent=`📄 ${r.score}% CV match`;button.onclick=()=>breakdown(job);});saveJobs(list);}
  function bind(){const modal=document.querySelector('#cv-modal'),form=document.querySelector('#cv-form'),input=document.querySelector('#cv-profile');if(!modal||!form||!input)return;input.value=readCV();document.querySelectorAll('[data-open-cv]').forEach(b=>b.addEventListener('click',()=>{input.value=readCV();modal.showModal();}));document.querySelectorAll('[data-close-cv]').forEach(b=>b.addEventListener('click',()=>modal.close()));form.addEventListener('submit',e=>{e.preventDefault();const v=input.value.trim();if(!v)return;saveCV(v);updateAll();document.querySelector('#cv-status').textContent='CV saved locally. Matching your current roles…';setTimeout(()=>{modal.close();render();},50);});}
  window.cvMatcher={matchJob,readCV,saveCV,render,updateAll}; bind(); const list=document.querySelector('#job-list'); if(list)new MutationObserver(()=>setTimeout(render,0)).observe(list,{childList:true,subtree:true}); setTimeout(()=>{updateAll();render();},150);
})();
