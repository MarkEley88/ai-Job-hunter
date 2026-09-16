/* Requirements-first CV matching. Free/local only: no external API calls. */
(() => {
  const CV_KEY='ai-job-hunter-cv-v1', JOBS_KEY='ai-job-hunter-jobs-v1';
  const CONCEPTS={
    operations:['operations','operational','operating','business operations','service operations','customer operations'],
    transformation:['transformation','transformational','digital transformation','business transformation'],
    change:['change','business change','change delivery','change management','change programme','change portfolio'],
    strategy:['strategy','strategic','strategic planning','strategy execution'],
    leadership:['leadership','leading teams','people leadership','senior management','management'],
    pmo:['pmo','project management office','programme management office','portfolio management office'],
    governance:['governance','governance framework','controls','control framework','management framework'],
    regulatory:['regulatory','regulated','pra','fca','consumer duty','conduct risk','financial crime'],
    financial:['financial services','banking','bank','fintech','payments','lending','lender','credit','savings','mortgage','insurance','wealth'],
    process:['process','process improvement','process optimisation','process optimization','process redesign','process re-engineering','process mapping'],
    lean:['lean','lean management','lean six sigma','continuous improvement','kaizen','mckinsey 5 phase'],
    customer:['customer','customer journey','customer experience','cx','customer-centric','client'],
    delivery:['delivery','programme delivery','project delivery','implementation','implementation delivery'],
    operatingmodel:['operating model','target operating model','tom','service model'],
    resilience:['resilience','operational resilience','business continuity'],
    risk:['risk','risk management','risk appetite','risk control','credit risk','operational risk'],
    compliance:['compliance','compliant','compliance framework'],
    automation:['automation','automate','automated','workflow automation','digitisation','digitalisation'],
    continuous:['continuous improvement','operational excellence','process excellence'],
    stakeholder:['stakeholder','stakeholder management','senior stakeholders','cross-functional'],
    portfolio:['portfolio','change portfolio','programme portfolio','project portfolio'],
    efficiency:['efficiency','operational efficiency','cost reduction','cost saving','productivity'],
    technology:['technology','digital','systems','technology change','platform implementation'],
    servicing:['servicing','customer servicing','account servicing','loan servicing','back office'],
    people:['people','team','teams','coaching','mentoring','mentorship','training','team development'],
    data:['data','analytics','reporting','management information','data entry'],
    erp:['erp','enterprise resource planning','system implementation'],
    crm:['crm','salesforce','customer relationship management'],
    documentation:['documentation','process documentation','process mapping','blueworks','visio','standardisation','standardization'],
    lending:['lending','loan','loans','underwriting','credit operations','credit risk','loan lifecycle'],
    outsourcing:['outsourcing','offshoring','offshore','third party operations'],
    benefits:['cost benefit','cost-benefit','savings','benefit realisation','benefits realisation','business case','roi']
  };
  const STOP=new Set('the and for with that this from your you are our their they will have has into about role job team across including required desirable ability able experience knowledge skills strong excellent working work lead leading manage managing responsible responsibilities'.split(' '));
  const REQUIREMENT_HEAD=/^(requirements?|what we(?:'|’)re looking for|what you(?:'|’)ll (?:need|bring|do)|about you|you(?:'|’)ll bring|your experience|skills?|qualifications?|essential|must have|key requirements|person specification|candidate profile|who you are|to be successful|the ideal candidate|we(?:'|’)re looking for|what we need)/i;
  const RESPONSIBILITY_HEAD=/^(responsibilities|key responsibilities|what you(?:'|’)ll do|your role|the role|in this role|you will|about the role|role overview|day to day)/i;
  const EXCLUDE_HEAD=/^(about us|about the company|our company|benefits|salary|location|what we offer|perks|diversity|equal opportunities|how to apply)/i;
  function norm(v){return String(v||'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9+.#/-]+/g,' ').replace(/\s+/g,' ').trim();}
  function tokens(v){return norm(v).split(' ').filter(x=>x.length>2&&!STOP.has(x));}
  function hasConcept(text,c){const h=norm(text);return(CONCEPTS[c]||[c]).some(t=>h.includes(norm(t)));}
  function concepts(text){return Object.keys(CONCEPTS).filter(c=>hasConcept(text,c));}
  function cv(){return localStorage.getItem(CV_KEY)||'';}
  function jobs(){try{return JSON.parse(localStorage.getItem(JOBS_KEY))||[]}catch{return[]}}
  function save(v){localStorage.setItem(JOBS_KEY,JSON.stringify(v));}
  function extractRequirements(description,title){
    const raw=String(description||'').replace(/\r/g,'').replace(/[\u2022\u25cf\u25aa\u25e6]/g,'\n');
    const lines=raw.split(/\n+/).map(x=>x.replace(/^\s*[-*]\s*/,'').trim()).filter(x=>x.length>=25&&x.length<=320);
    let section='neutral', req=[], responsibilities=[];
    for(const line of lines){
      if(REQUIREMENT_HEAD.test(line)){section='requirements';continue;}
      if(RESPONSIBILITY_HEAD.test(line)){section='responsibilities';continue;}
      if(EXCLUDE_HEAD.test(line)){section='exclude';continue;}
      if(section==='requirements') req.push(line);
      else if(section==='responsibilities') responsibilities.push(line);
    }
    // If the advert has no recognisable requirements heading, use requirement-like lines
    // but explicitly down-weight generic responsibilities. Never treat the job title alone as a requirement.
    if(req.length<3){
      req=lines.filter(x=>/\b(?:experience|experienced|knowledge|understanding|proven|track record|ability|able|skills?|expertise|qualification|degree|must|essential|required|you(?:'|’)ll bring|we(?:'|’)re looking for)\b/i.test(x));
    }
    const clean=a=>a.filter((x,i)=>a.findIndex(y=>norm(y)===norm(x))===i);
    req=clean(req).slice(0,14); responsibilities=clean(responsibilities).slice(0,10);
    // Requirement weighting: explicit requirements 70%, responsibilities 20%, role/domain context 10%.
    return {requirements:req.map(text=>({text,type:'requirement'})),responsibilities:responsibilities.map(text=>({text,type:'responsibility'})),title:String(title||'')};
  }
  function evidence(text,cvText){
    const a=norm(text), b=norm(cvText), ts=tokens(text).filter(x=>x.length>3), direct=ts.filter(t=>b.includes(t)).length;
    const cs=concepts(text), hits=cs.filter(c=>hasConcept(cvText,c));
    let e=Math.min(hits.length,3)*.2;
    if(hits.length)e+=.12;
    if(ts.length)e+=Math.min(1,direct/Math.min(ts.length,8))*.28;
    const phrase=cs.some(c=>(CONCEPTS[c]||[]).some(t=>a.includes(norm(t))&&b.includes(norm(t))));
    if(phrase)e+=.3;
    if(/\b(?:£\s?\d|\d+%|cost saving|cost benefit|reduced|increased|improved|delivered|implemented|established)\b/i.test(cvText)&&/\b(?:deliver|delivery|improve|improvement|reduce|reduction|increase|growth|saving|benefit|implementation)\b/i.test(text))e+=.08;
    return Math.max(0,Math.min(1,e));
  }
  function match(job){
    const c=cv(); if(!c.trim())return null;
    const extracted=extractRequirements(job.description,job.title), all=[...extracted.requirements,...extracted.responsibilities];
    if(!all.length)return{score:0,matched:0,partial:0,missing:0,total:0,requirements:[],basis:'No explicit requirements could be extracted'};
    const scored=all.map(r=>({...r,evidence:Math.round(evidence(r.text,c)*100)}));
    const requirements=scored.filter(x=>x.type==='requirement'), responsibilities=scored.filter(x=>x.type==='responsibility');
    const classify=x=>x.evidence>=55?'matched':x.evidence>=28?'partial':'missing';
    scored.forEach(x=>x.status=classify(x));
    const weighted=(arr)=>arr.length?arr.reduce((s,x)=>s+(x.status==='matched'?1:x.status==='partial'?.5:0),0)/arr.length:0;
    const reqScore=weighted(requirements), respScore=weighted(responsibilities), context=concepts(job.description).filter(x=>hasConcept(c,x)).length;
    const contextTotal=concepts(job.description).length;
    const contextRatio=contextTotal?context/contextTotal:0;
    const score=Math.round(Math.min(100,(reqScore*.70+respScore*.20+contextRatio*.10)*100));
    return{score,matched:scored.filter(x=>x.status==='matched').length,partial:scored.filter(x=>x.status==='partial').length,missing:scored.filter(x=>x.status==='missing').length,total:scored.length,requirements:scored,requirementCount:requirements.length,responsibilityCount:responsibilities.length,basis:'Requirements-first: explicit requirements weighted most heavily; responsibilities and job context are secondary.',updatedAt:Date.now()};
  }
  function refresh(){const list=jobs();if(!cvcv())return;list.forEach(j=>j.cvMatch=match(j));save(list);renderCards();}
  function cvcv(){return cv().trim();}
  function renderCards(){
    const list=jobs();
    document.querySelectorAll('.job-card').forEach(card=>{
      const title=card.querySelector('h3')?.textContent||'', company=card.querySelector('.company')?.textContent||'', job=list.find(j=>String(j.title||'')===title&&String(j.company||'')===company); if(!job)return;
      const badge=card.querySelector('.cv-match-badge'),summary=card.querySelector('.cv-match-summary'),button=card.querySelector('.score-cv'); if(!badge||!button)return;
      if(!cvcv()){badge.hidden=true;summary.hidden=true;button.textContent='📄 Add CV to score';button.onclick=()=>document.querySelector('[data-open-cv]')?.click();return;}
      const r=job.cvMatch||match(job);job.cvMatch=r;badge.hidden=false;badge.className=`cv-match-badge ${r.score>=75?'high':r.score>=50?'medium':'low'}`;badge.textContent=`📄 CV match · ${r.score}%`;
      summary.hidden=false;summary.innerHTML=`<strong>${r.score}% requirements-first match</strong><span>${r.requirementCount||0} explicit requirements · ${r.responsibilityCount||0} responsibilities assessed</span><button type="button" class="view-cv-match">View breakdown</button>`;
      summary.querySelector('button').onclick=()=>breakdown(job);
      button.textContent=`📄 Re-score CV · ${r.score}%`;button.onclick=()=>{job.cvMatch=match(job);const fresh=jobs();const i=fresh.findIndex(x=>x.id===job.id);if(i>=0)fresh[i].cvMatch=job.cvMatch;save(fresh);renderCards();window.overallScore?.refresh();};
    });
    window.overallScore?.refresh();
  }
  function breakdown(job){const r=job.cvMatch||match(job);if(!r)return;document.querySelector('#cv-breakdown-modal')?.remove();const d=document.createElement('dialog');d.id='cv-breakdown-modal';d.className='modal cv-breakdown-modal';d.innerHTML=`<div class="modal-header"><div><p class="eyebrow">Free local CV analysis</p><h2>${esc(job.title)}</h2><p class="company">${esc(job.company)}</p></div><button class="icon-button" type="button" data-cv-close>×</button></div><div class="cv-score-hero"><strong>${r.score}%</strong><span>Requirements-first match</span><small>${r.matched} matched · ${r.partial} partial · ${r.missing} not evidenced</small></div><p class="cv-summary">Explicit job requirements carry the most weight. Responsibilities and broader job context are secondary. Your CV and job advert stay in this browser; no external AI service is used.</p><section><h3>What the advert actually asks for</h3>${r.requirements.map(x=>`<div class="requirement-row ${x.status}"><strong>${x.type==='requirement'?'Requirement':'Responsibility'} · ${x.status==='matched'?'✓ Matched':x.status==='partial'?'≈ Partial':'○ Not evidenced'}</strong><p>${esc(x.text)}</p><small>Evidence match: ${x.evidence}%</small></div>`).join('')}</section><div class="modal-actions"><button class="btn btn-primary" type="button" data-cv-close>Close</button></div>`;document.body.appendChild(d);d.showModal();d.querySelectorAll('[data-cv-close]').forEach(b=>b.onclick=()=>d.close());}
  function esc(v){return String(v||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  window.requirementsCvMatcher={match,refresh};
  window.addEventListener('jobs-rendered',refresh);
  document.querySelector('#cv-form')?.addEventListener('submit',()=>setTimeout(refresh,100));
  setTimeout(refresh,250);
})();
