/* Requirements-first CV matcher v2: parses real advert sections/bullets locally. No external API calls. */
(() => {
  const CV_KEY='ai-job-hunter-cv-v1', JOBS_KEY='ai-job-hunter-jobs-v1';
  const CONCEPTS={
    operations:['operations','operational','operating','business operations','service operations','customer operations'],
    transformation:['transformation','transformational','digital transformation','business transformation'],
    change:['change','business change','change delivery','change management','change programme','change portfolio'],
    strategy:['strategy','strategic','strategic planning','strategy execution'], leadership:['leadership','leading teams','people leadership','senior management','management'],
    pmo:['pmo','project management office','programme management office','portfolio management office'], governance:['governance','governance framework','controls','control framework','management framework'],
    regulatory:['regulatory','regulated','pra','fca','consumer duty','conduct risk','financial crime'], financial:['financial services','banking','bank','fintech','payments','lending','lender','credit','savings','mortgage','insurance','wealth'],
    process:['process','process improvement','process optimisation','process optimization','process redesign','process re-engineering','process mapping'], lean:['lean','lean management','lean six sigma','continuous improvement','kaizen','mckinsey 5 phase'],
    customer:['customer','customer journey','customer experience','cx','customer-centric','client'], delivery:['delivery','programme delivery','project delivery','implementation','implementation delivery'], operatingmodel:['operating model','target operating model','tom','service model'],
    resilience:['resilience','operational resilience','business continuity'], risk:['risk','risk management','risk appetite','risk control','credit risk','operational risk'], compliance:['compliance','compliant','compliance framework'],
    automation:['automation','automate','automated','workflow automation','digitisation','digitalisation'], continuous:['continuous improvement','operational excellence','process excellence'], stakeholder:['stakeholder','stakeholder management','senior stakeholders','cross-functional'],
    portfolio:['portfolio','change portfolio','programme portfolio','project portfolio'], efficiency:['efficiency','operational efficiency','cost reduction','cost saving','productivity'], technology:['technology','digital','systems','technology change','platform implementation'],
    servicing:['servicing','customer servicing','account servicing','loan servicing','back office'], people:['people','team','teams','coaching','mentoring','mentorship','training','team development'], data:['data','analytics','reporting','management information','data entry'],
    erp:['erp','enterprise resource planning','system implementation'], crm:['crm','salesforce','customer relationship management'], documentation:['documentation','process documentation','process mapping','blueworks','visio','standardisation','standardization'],
    lending:['lending','loan','loans','underwriting','credit operations','credit risk','loan lifecycle'], outsourcing:['outsourcing','offshoring','offshore','third party operations'], benefits:['cost benefit','cost-benefit','savings','benefit realisation','benefits realisation','business case','roi']
  };
  const STOP=new Set('the and for with that this from your you are our their they will have has into about role job team across including required desirable ability able experience knowledge skills strong excellent working work lead leading manage managing responsible responsibilities'.split(' '));
  const REQ=/^(requirements?|what (?:we|you|you(?:'|’)ll) (?:need|bring|are looking for|you(?:'|’)ll bring)|about you|you(?:'|’)ll bring|your experience|skills?|qualifications?|essential criteria|essential|must have|key requirements|person specification|candidate profile|who you are|to be successful|the ideal candidate|we(?:'|’)re looking for|what we need|what you'll need|what you'll bring)/i;
  const RESP=/^(responsibilities|key responsibilities|what you(?:'|’)ll do|your role|the role|in this role|you will|about the role|role overview|day to day|what you will do)/i;
  const IGNORE=/^(about us|about the company|our company|benefits|salary|location|what we offer|perks|diversity|equal opportunities|how to apply|our values|why join)/i;
  function cv(){return localStorage.getItem(CV_KEY)||'';}
  function jobs(){try{return JSON.parse(localStorage.getItem(JOBS_KEY))||[]}catch{return[]}}
  function save(x){localStorage.setItem(JOBS_KEY,JSON.stringify(x));}
  function norm(v){return String(v||'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9+.#/%£-]+/g,' ').replace(/\s+/g,' ').trim();}
  function tokens(v){return norm(v).split(' ').filter(x=>x.length>2&&!STOP.has(x));}
  function hasConcept(text,c){const h=norm(text);return(CONCEPTS[c]||[]).some(t=>h.includes(norm(t)));}
  function concepts(text){return Object.keys(CONCEPTS).filter(c=>hasConcept(text,c));}
  function stripHtml(v){const d=document.createElement('div');d.innerHTML=String(v||'');return(d.textContent||d.innerText||'').replace(/\u00a0/g,' ').replace(/\r/g,'');}
  function splitLines(v){return String(v).replace(/\r/g,'').split(/\n+/).flatMap(x=>x.split(/(?<=[.!?])\s+(?=[A-Z])/)).map(x=>x.replace(/^\s*(?:[-*•▪◦·]|\d+[.)])\s*/,'').replace(/^\s*[|>]+\s*/,'').trim()).filter(x=>x.length>=25&&x.length<=360);}
  function extract(description){
    const raw=stripHtml(description), lines=splitLines(raw); let section='neutral', req=[], resp=[];
    for(const line of lines){
      const heading=line.replace(/[:\-–—]\s*$/,'').trim();
      if(REQ.test(heading)){section='requirements'; const rest=line.replace(/^[^:]{0,90}[:\-–—]\s*/,'').trim(); if(rest.length>=25)req.push(rest); continue;}
      if(RESP.test(heading)){section='responsibilities'; const rest=line.replace(/^[^:]{0,90}[:\-–—]\s*/,'').trim(); if(rest.length>=25)resp.push(rest); continue;}
      if(IGNORE.test(heading)){section='ignore';continue;}
      if(section==='requirements')req.push(line); else if(section==='responsibilities')resp.push(line);
    }
    const likely=lines.filter(x=>/\b(?:experience|experienced|knowledge|understanding|proven|track record|ability|able to|skills?|expertise|qualification|degree|certification|must|essential|required|background in|demonstrable|you have|you will bring|we are looking for|we're looking for)\b/i.test(x));
    if(req.length<3) req=likely;
    const unique=a=>a.filter((x,i)=>a.findIndex(y=>norm(y)===norm(x))===i);
    return {requirements:unique(req).slice(0,18),responsibilities:unique(resp).slice(0,10)};
  }
  function evidence(text){
    const c=cv(), a=norm(text), b=norm(c), ts=tokens(text).filter(x=>x.length>3), direct=ts.filter(t=>b.includes(t)).length, cs=concepts(text), hits=cs.filter(k=>hasConcept(c,k));
    let e=0; e+=Math.min(hits.length,4)*.16; if(ts.length)e+=Math.min(1,direct/Math.min(ts.length,8))*.25;
    if(cs.some(k=>(CONCEPTS[k]||[]).some(t=>a.includes(norm(t))&&b.includes(norm(t)))))e+=.30;
    if(/\b(?:£\s?\d|\d+%|cost saving|cost benefit|reduced|increased|improved|delivered|implemented|established)\b/i.test(c)&&/\b(?:deliver|delivery|improve|improvement|reduce|reduction|increase|growth|saving|benefit|implementation)\b/i.test(text))e+=.09;
    if(/\b(?:people management|line management|manage a team|lead a team|senior stakeholders?)\b/i.test(text)&&hasConcept(c,'leadership'))e+=.12;
    if(/\b(?:regulated|regulatory|pra|fca|consumer duty)\b/i.test(text)&&hasConcept(c,'regulatory'))e+=.12;
    return Math.max(0,Math.min(1,e));
  }
  function match(job){
    const c=cv(); if(!c.trim())return null;
    const x=extract(job.description), req=x.requirements.map(text=>({text,type:'requirement'})), resp=x.responsibilities.map(text=>({text,type:'responsibility'})), all=[...req,...resp];
    if(!all.length)return{score:0,matched:0,partial:0,missing:0,total:0,requirements:[],requirementCount:0,responsibilityCount:0,basis:'No explicit requirements could be extracted'};
    const scored=all.map(r=>({...r,evidence:Math.round(evidence(r.text)*100)})); scored.forEach(r=>r.status=r.evidence>=55?'matched':r.evidence>=28?'partial':'missing');
    const weighted=a=>a.length?a.reduce((s,r)=>s+(r.status==='matched'?1:r.status==='partial'?.5:0),0)/a.length:0;
    const rs=scored.filter(r=>r.type==='requirement'), ps=scored.filter(r=>r.type==='responsibility'), ctx=concepts(job.description), hits=ctx.filter(k=>hasConcept(c,k)).length, ctxRatio=ctx.length?hits/ctx.length:0;
    const score=Math.round(Math.min(100,(weighted(rs)*.70+weighted(ps)*.20+ctxRatio*.10)*100));
    return{score,matched:scored.filter(r=>r.status==='matched').length,partial:scored.filter(r=>r.status==='partial').length,missing:scored.filter(r=>r.status==='missing').length,total:scored.length,requirements:scored,requirementCount:rs.length,responsibilityCount:ps.length,basis:'Requirements-first: explicit requirements 70%, responsibilities 20%, wider role context 10%.',updatedAt:Date.now()};
  }
  function refresh(){if(!cv().trim())return;const list=jobs();list.forEach(j=>j.cvMatch=match(j));save(list);document.querySelectorAll('.job-card').forEach(card=>{const title=card.querySelector('h3')?.textContent||'',company=card.querySelector('.company')?.textContent||'',j=list.find(x=>String(x.title||'')===title&&String(x.company||'')===company);if(!j)return;const r=j.cvMatch,b=card.querySelector('.cv-match-badge'),s=card.querySelector('.cv-match-summary'),btn=card.querySelector('.score-cv');if(b){b.hidden=false;b.className=`cv-match-badge ${r.score>=75?'high':r.score>=50?'medium':'low'}`;b.textContent=`📄 CV match · ${r.score}%`;}if(s){s.hidden=false;s.innerHTML=`<strong>${r.score}% requirements-first match</strong><span>${r.requirementCount} requirements · ${r.responsibilityCount} responsibilities assessed</span><button type="button" class="view-cv-match">View breakdown</button>`;s.querySelector('button').onclick=()=>breakdown(j);}if(btn){btn.textContent=`📄 Re-score CV · ${r.score}%`;btn.onclick=()=>{j.cvMatch=match(j);const fresh=jobs(),i=fresh.findIndex(x=>x.id===j.id);if(i>=0)fresh[i].cvMatch=j.cvMatch;save(fresh);refresh();window.overallScore?.refresh();};}});window.overallScore?.refresh();}
  function breakdown(job){const r=job.cvMatch;if(!r)return;document.querySelector('#cv-breakdown-modal')?.remove();const d=document.createElement('dialog');d.id='cv-breakdown-modal';d.className='modal cv-breakdown-modal';d.innerHTML=`<div class="modal-header"><div><p class="eyebrow">Free local CV analysis</p><h2>${esc(job.title)}</h2><p class="company">${esc(job.company)}</p></div><button class="icon-button" type="button" data-cv-close>×</button></div><div class="cv-score-hero"><strong>${r.score}%</strong><span>Requirements-first match</span><small>${r.matched} matched · ${r.partial} partial · ${r.missing} not evidenced</small></div><p class="cv-summary">The advert is parsed for explicit requirements and responsibilities. Requirements carry the most weight. Your CV and advert remain in this browser and are not sent to an external AI service.</p><section><h3>What the employer actually asks for</h3>${r.requirements.map(x=>`<div class="requirement-row ${x.status}"><strong>${x.type==='requirement'?'Requirement':'Responsibility'} · ${x.status==='matched'?'✓ Matched':x.status==='partial'?'≈ Partial':'○ Not evidenced'}</strong><p>${esc(x.text)}</p><small>Evidence match: ${x.evidence}%</small></div>`).join('')}</section><div class="modal-actions"><button class="btn btn-primary" type="button" data-cv-close>Close</button></div>`;document.body.appendChild(d);d.showModal();d.querySelectorAll('[data-cv-close]').forEach(b=>b.onclick=()=>d.close());}
  function esc(v){return String(v||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  window.requirementsCvMatcher={match,refresh};
  window.addEventListener('jobs-rendered',refresh); document.querySelector('#cv-form')?.addEventListener('submit',()=>setTimeout(refresh,150)); setTimeout(refresh,300);
})();
