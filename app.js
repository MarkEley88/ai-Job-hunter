const STORAGE_KEY = 'ai-job-hunter-jobs-v1';

const API_URL = 'https://ai-job-hunter-vert.vercel.app/api/jobs';

const samples = [
  {
    title: 'Head of Transformation',
    company: 'Atom Bank',
    location: 'Durham / Hybrid',
    salary: '£135,000 – £155,000',
    bonus: '20% bonus + pension',
    url: 'https://www.atombank.co.uk/careers/',
    status: 'Interested',
    description: 'Lead enterprise-wide transformation, strategic delivery and operating model change in a digital challenger bank.'
  },
  {
    title: 'Director of Operations',
    company: 'Zopa Bank',
    location: 'London / Hybrid',
    salary: '£140,000 – £165,000',
    bonus: 'Bonus + 10% pension',
    url: 'https://careers.zopa.com/',
    status: 'Applied',
    description: 'Own customer operations, servicing performance, controls and operational excellence across a rapidly growing digital bank.'
  },
  {
    title: 'Head of Change Delivery',
    company: 'Shawbrook',
    location: 'London / Hybrid',
    salary: '£120,000 – £140,000',
    bonus: '15% bonus',
    url: 'https://www.shawbrook.co.uk/careers/',
    status: 'Interview',
    description: 'Shape the change portfolio and lead cross-functional delivery for a specialist savings and lending bank.'
  }
];

function calculateFit(job) {
  const text = [job.title, job.company, job.location, job.description, job.salary]
    .join(' ')
    .toLowerCase();

  let score = 20;

  if ([
    'head of operations', 'head of transformation', 'head of change',
    'head of strategy', 'strategy & transformation', 'strategy and transformation',
    'coo', 'chief operating officer', 'chief transformation officer',
    'director of operations', 'director of transformation', 'director of change',
    'change delivery', 'transformation director', 'operations director'
  ].some(word => text.includes(word))) {
    score += 35;
  }

  if (/(bank|fintech|payments|lender|financial services|financial|mortgage|savings|credit|insurance)/.test(text)) {
    score += 22;
  }

  if (/(london|uk|united kingdom|hybrid|remote|england)/.test(text)) {
    score += 8;
  }

  const numbers = (job.salary || '')
    .match(/\d[\d,]*/g)
    ?.map(value => Number(value.replace(/,/g, ''))) || [];

  if (numbers.some(value => value >= 120000)) score += 15;
  else if (numbers.some(value => value >= 100000)) score += 8;

  if (/(lead|enterprise|strategic|operating model|governance|executive|customer operations|operational excellence)/.test(text)) {
    score += 7;
  }

  if (/(project manager|junior|analyst|administrator|support technician|helpdesk|developer|software engineer|retail assistant)/.test(text)) {
    score -= 30;
  }

  if (/(it operations|technical support|infrastructure|devops|data engineer|software development)/.test(text) &&
      !/(head of operations|chief operating officer|coo|director of operations)/.test(text)) {
    score -= 20;
  }

  return Math.max(0, Math.min(100, score));
}

function category(score) {
  if (score >= 80) return 'Excellent';
  if (score >= 65) return 'Strong';
  if (score >= 45) return 'Possible';
  return 'Poor fit';
}

function categoryIcon(name) {
  return { Excellent: '🔥', Strong: '⭐', Possible: '👍', 'Poor fit': '❌' }[name];
}

function classFor(name) {
  return { Excellent: 'excellent', Strong: 'strong', Possible: 'possible', 'Poor fit': 'poor' }[name];
}

function getJobs() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveJobs(jobs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
}

function initialise() {
  if (!localStorage.getItem(STORAGE_KEY)) {
    saveJobs(samples.map((job, index) => ({
      ...job,
      id: `sample-${Date.now()}-${index}`,
      score: calculateFit(job)
    })));
  }
}

const jobList = document.querySelector('#job-list');
const template = document.querySelector('#job-template');
const statusFilter = document.querySelector('#status-filter');
const fitFilter = document.querySelector('#fit-filter');

function render() {
  const jobs = getJobs();

  const visible = jobs.filter(job =>
    (statusFilter.value === 'all' || job.status === statusFilter.value) &&
    (fitFilter.value === 'all' || category(job.score) === fitFilter.value)
  );

  jobList.replaceChildren();

  if (!visible.length) {
    jobList.innerHTML = '<div class="empty">No opportunities match these filters. Try clearing them or add a new role.</div>';
  }

  visible.sort((a, b) => b.score - a.score).forEach(job => {
    const card = template.content.cloneNode(true);
    const fit = category(job.score);
    const badge = card.querySelector('.fit-badge');

    badge.textContent = `${categoryIcon(fit)} ${fit} · ${job.score}/100`;
    badge.classList.add(classFor(fit));
    card.querySelector('.job-status').textContent = job.status || 'Interested';
    card.querySelector('h3').textContent = job.title || 'Untitled role';
    card.querySelector('.company').textContent = job.company || 'Unknown company';

    const meta = card.querySelector('.job-meta');
    [job.location, job.salary, job.bonus, job.source ? `Found on ${job.source}` : '']
      .filter(Boolean)
      .forEach(value => {
        const item = document.createElement('span');
        item.textContent = value;
        meta.append(item);
      });

    card.querySelector('.reason').textContent = explanation(job, fit);

    const descriptionDetails = card.querySelector('.job-description');
    const descriptionBody = card.querySelector('.description-body');

    if (job.description && job.description.trim()) {
      descriptionBody.textContent = job.description.trim();
    } else {
      descriptionDetails.remove();
    }

    const applicationDetails = card.querySelector('.application-options');
    const applicationLinks = card.querySelector('.application-links');
    const options = Array.isArray(job.applyOptions) && job.applyOptions.length
      ? job.applyOptions
      : Array.isArray(job.sources) && job.sources.length
        ? job.sources
        : job.url
          ? [{ name: job.source || 'Apply', url: job.url }]
          : [];

    if (options.length) {
      options.forEach(option => {
        if (!option.url) return;
        const link = document.createElement('a');
        link.href = option.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = `Apply via ${option.name || 'source'} ↗`;
        link.className = 'application-link';
        applicationLinks.append(link);
      });
    } else {
      applicationDetails.remove();
    }

    const link = card.querySelector('.job-link');
    if (job.url) {
      link.href = job.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    } else {
      link.removeAttribute('href');
      link.textContent = 'No URL added';
      link.style.opacity = '.5';
    }

    const select = card.querySelector('.status-select');
    select.value = job.status || 'Interested';
    select.addEventListener('change', () => updateJob(job.id, { status: select.value }));

    card.querySelector('.delete-job').addEventListener('click', () => {
      if (confirm('Remove this opportunity?')) {
        saveJobs(getJobs().filter(item => item.id !== job.id));
        render();
      }
    });

    jobList.append(card);
  });

  document.querySelector('#job-count').textContent = jobs.length;
  document.querySelector('#excellent-count').textContent = jobs.filter(job => category(job.score) === 'Excellent').length;
  document.querySelector('#active-count').textContent = jobs.filter(job => ['Applied', 'Interview'].includes(job.status)).length;
  document.querySelector('#average-fit').textContent = jobs.length
    ? Math.round(jobs.reduce((sum, job) => sum + job.score, 0) / jobs.length)
    : 0;
}

function explanation(job, fit) {
  const sector = /(bank|fintech|payments|lender|financial|mortgage|credit)/i.test([job.company, job.description].join(' '));

  if (fit === 'Excellent') return 'Exceptional alignment: senior leadership scope, financial-services relevance and compensation meet your core criteria.';
  if (fit === 'Strong') return `Strong match with clear operational or transformation relevance${sector ? ' in your target financial-services market.' : '.'}`;
  if (fit === 'Possible') return 'Some relevant signals, but review the seniority, sector focus or package before prioritising.';
  return 'Limited alignment with your target senior leadership roles, financial-services focus or salary threshold.';
}

function updateJob(id, changes) {
  saveJobs(getJobs().map(job => job.id === id ? { ...job, ...changes } : job));
  render();
}

function mergeFetchedJobs(existing, incoming) {
  const result = [...existing];

  for (const job of incoming) {
    const company = normalise(job.company);
    const title = normalise(job.title);
    const location = normalise(job.location);

    const match = result.find(existingJob => {
      if (normalise(existingJob.company) !== company) return false;
      if (job.url && existingJob.url === job.url) return true;
      if (normalise(existingJob.title) === title && normalise(existingJob.location) === location) return true;
      return tokenSimilarity(normalise(existingJob.title), title) >= 0.8 &&
        (!location || !normalise(existingJob.location) || normalise(existingJob.location).includes(location) || location.includes(normalise(existingJob.location)));
    });

    if (!match) {
      result.push(job);
      continue;
    }

    const incomingSources = job.applyOptions || job.sources || (job.url ? [{ name: job.source || 'Source', url: job.url }] : []);
    const existingSources = match.applyOptions || match.sources || (match.url ? [{ name: match.source || 'Source', url: match.url }] : []);
    const combined = [...existingSources];

    incomingSources.forEach(source => {
      if (source.url && !combined.some(existingSource => existingSource.url === source.url)) {
        combined.push(source);
      }
    });

    match.applyOptions = combined;
    match.sources = combined;
    match.source = combined.map(source => source.name).filter(Boolean).join(' + ');

    if ((!match.description || match.description.length < (job.description || '').length) && job.description) {
      match.description = job.description;
    }
  }

  return result;
}

function normalise(value) {
  return String(value || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenSimilarity(a, b) {
  const aTokens = new Set(a.split(' ').filter(Boolean));
  const bTokens = new Set(b.split(' ').filter(Boolean));
  if (!aTokens.size || !bTokens.size) return 0;
  const intersection = [...aTokens].filter(token => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return union ? intersection / union : 0;
}

const modal = document.querySelector('#job-modal');

document.querySelectorAll('[data-open-modal]').forEach(button => button.addEventListener('click', () => modal.showModal()));
document.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', () => modal.close()));

document.querySelector('#job-form').addEventListener('submit', event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const job = { ...data, id: `manual-${Date.now()}` };
  job.score = calculateFit(job);
  saveJobs([...getJobs(), job]);
  event.currentTarget.reset();
  modal.close();
  statusFilter.value = 'all';
  fitFilter.value = 'all';
  render();
});

const searchPanel = document.querySelector('#search-panel');
const openSearchButtons = document.querySelectorAll('[data-open-search]');
const findJobsButton = document.querySelector('#find-jobs-button');
const searchStatus = document.querySelector('#search-status');
const searchResults = document.querySelector('#search-results');

openSearchButtons.forEach(button => button.addEventListener('click', () => {
  searchPanel.hidden = false;
  searchPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}));

document.querySelector('[data-close-search]').addEventListener('click', () => {
  searchPanel.hidden = true;
});

findJobsButton.addEventListener('click', async () => {
  const keywords = document.querySelector('#search-keywords').value.trim();
  const location = document.querySelector('#search-location').value.trim();
  const salary = Number(document.querySelector('#search-salary').value) || 0;
  const sector = document.querySelector('#search-sector').value;

  findJobsButton.disabled = true;
  searchStatus.textContent = 'Searching multiple job sources…';
  searchResults.replaceChildren();

  try {
    const params = new URLSearchParams({ keywords, location, minSalary: String(salary), sector });
    const response = await fetch(`${API_URL}?${params.toString()}`);

    if (!response.ok) throw new Error(`Search failed (${response.status})`);

    const data = await response.json();
    const jobs = Array.isArray(data.jobs) ? data.jobs : Array.isArray(data) ? data : [];

    if (!jobs.length) {
      searchStatus.textContent = 'No matching jobs found.';
      return;
    }

    const enriched = jobs.map(job => ({
      ...job,
      id: job.id || `job-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      status: job.status || 'Interested',
      score: calculateFit(job)
    }));

    saveJobs(mergeFetchedJobs(getJobs(), enriched));

    const sourceText = Array.isArray(data.sources) ? data.sources.join(' + ') : 'job sources';
    searchStatus.textContent = `${enriched.length} unique matching jobs found across ${sourceText}; duplicate adverts are combined with multiple application options.`;
    render();
  } catch (error) {
    console.error(error);
    searchStatus.textContent = 'Unable to search right now. Check the API and try again.';
  } finally {
    findJobsButton.disabled = false;
  }
});

document.querySelector('#status-filter').addEventListener('change', render);
document.querySelector('#fit-filter').addEventListener('change', render);
document.querySelector('#clear-filters').addEventListener('click', () => {
  statusFilter.value = 'all';
  fitFilter.value = 'all';
  render();
});

initialise();
render();
