const STORAGE_KEY = 'ai-job-hunter-jobs-v1';

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
  },
  {
    title: 'Chief Operating Officer',
    company: 'Payments scale-up',
    location: 'London',
    salary: '£150,000 – £180,000',
    bonus: 'Equity + bonus',
    url: 'https://www.linkedin.com/jobs/',
    status: 'Interested',
    description: 'Build scalable operational infrastructure, governance and service delivery for a high-growth payments business.'
  },
  {
    title: 'Senior Project Manager',
    company: 'RetailCo',
    location: 'Manchester',
    salary: '£70,000',
    bonus: '',
    url: 'https://www.linkedin.com/jobs/',
    status: 'Rejected',
    description: 'Manage retail technology projects and supplier delivery.'
  }
];

function calculateFit(job) {
  const text = [
    job.title,
    job.company,
    job.location,
    job.description,
    job.salary
  ].join(' ').toLowerCase();

  let score = 20;

  if (
    [
      'head of operations',
      'head of transformation',
      'head of change',
      'strategy',
      'coo',
      'chief operating',
      'director of operations',
      'director of transformation',
      'change delivery'
    ].some(word => text.includes(word))
  ) {
    score += 35;
  }

  if (
    /(bank|fintech|payments|lender|financial services|finance|mortgage|savings)/.test(text)
  ) {
    score += 22;
  }

  if (
    /(london|hybrid|uk|remote|durham)/.test(text)
  ) {
    score += 8;
  }

  const numbers = (job.salary.match(/\d[\d,]*/g) || [])
    .map(value => Number(value.replace(/,/g, '')));

  if (numbers.some(value => value >= 120000)) {
    score += 15;
  } else if (numbers.some(value => value >= 100000)) {
    score += 8;
  }

  if (
    /(lead|enterprise|strategic|operating model|governance|executive)/.test(text)
  ) {
    score += 7;
  }

  if (
    /(project manager|junior|analyst|retail)/.test(text) &&
    !/(bank|fintech|payments)/.test(text)
  ) {
    score -= 25;
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
  return {
    Excellent: '🔥',
    Strong: '⭐',
    Possible: '👍',
    'Poor fit': '❌'
  }[name];
}

function classFor(name) {
  return {
    Excellent: 'excellent',
    Strong: 'strong',
    Possible: 'possible',
    'Poor fit': 'poor'
  }[name];
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
    saveJobs(
      samples.map((job, index) => ({
        ...job,
        id: Date.now() + index,
        score: calculateFit(job)
      }))
    );
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
    jobList.innerHTML =
      '<div class="empty">No opportunities match these filters. Try clearing them or add a new role.</div>';
  }

  visible
    .sort((a, b) => b.score - a.score)
    .forEach(job => {
      const card = template.content.cloneNode(true);

      const fit = category(job.score);

      const badge = card.querySelector('.fit-badge');

      badge.textContent =
        `${categoryIcon(fit)} ${fit} · ${job.score}/100`;

      badge.classList.add(classFor(fit));

      card.querySelector('.job-status').textContent = job.status;
      card.querySelector('h3').textContent = job.title;
      card.querySelector('.company').textContent = job.company;

      const meta = card.querySelector('.job-meta');

      [job.location, job.salary, job.bonus]
        .filter(Boolean)
        .forEach(value => {
          const item = document.createElement('span');
          item.textContent = value;
          meta.append(item);
        });

      card.querySelector('.reason').textContent =
        explanation(job, fit);

      const link = card.querySelector('.job-link');

      if (job.url) {
        link.href = job.url;
      } else {
        link.removeAttribute('href');
        link.textContent = 'No URL added';
        link.style.opacity = '.5';
      }

      const select = card.querySelector('.status-select');

      select.value = job.status;

      select.addEventListener('change', () => {
        updateJob(job.id, {
          status: select.value
        });
      });

      card
        .querySelector('.delete-job')
        .addEventListener('click', () => {
          if (confirm('Remove this opportunity?')) {
            saveJobs(
              getJobs().filter(item => item.id !== job.id)
            );

            render();
          }
        });

      jobList.append(card);
    });

  document.querySelector('#job-count').textContent =
    jobs.length;

  document.querySelector('#excellent-count').textContent =
    jobs.filter(job => category(job.score) === 'Excellent').length;

  document.querySelector('#active-count').textContent =
    jobs.filter(job =>
      ['Applied', 'Interview'].includes(job.status)
    ).length;

  document.querySelector('#average-fit').textContent =
    jobs.length
      ? Math.round(
          jobs.reduce(
            (sum, job) => sum + job.score,
            0
          ) / jobs.length
        )
      : 0;
}

function explanation(job, fit) {
  const sector =
    /(bank|fintech|payments|lender|financial)/i.test(
      [job.company, job.description].join(' ')
    );

  if (fit === 'Excellent') {
    return 'Exceptional alignment: senior leadership scope, financial-services relevance and compensation meet your core criteria.';
  }

  if (fit === 'Strong') {
    return `Strong match with clear operational or transformation relevance${
      sector
        ? ' in your target financial-services market.'
        : '.'
    }`;
  }

  if (fit === 'Possible') {
    return 'Some relevant signals, but review the seniority, sector focus or package before prioritising.';
  }

  return 'Limited alignment with your target senior leadership roles, financial-services focus or salary threshold.';
}

function updateJob(id, changes) {
  saveJobs(
    getJobs().map(job =>
      job.id === id
        ? { ...job, ...changes }
        : job
    )
  );

  render();
}

const modal = document.querySelector('#job-modal');

document
  .querySelectorAll('[data-open-modal]')
  .forEach(button => {
    button.addEventListener('click', () => {
      modal.showModal();
    });
  });

document
  .querySelectorAll('[data-close-modal]')
  .forEach(button => {
    button.addEventListener('click', () => {
      modal.close();
    });
  });

document
  .querySelector('#job-form')
  .addEventListener('submit', event => {
    event.preventDefault();

    const data = Object.fromEntries(
      new FormData(event.currentTarget)
    );

    const job = {
      ...data,
      id: Date.now()
    };

    job.score = calculateFit(job);

    saveJobs([
      ...getJobs(),
      job
    ]);

    event.currentTarget.reset();

    modal.close();

    statusFilter.value = 'all';
    fitFilter.value = 'all';

    render();
  });

[statusFilter, fitFilter].forEach(filter => {
  filter.addEventListener('change', render);
});

document
  .querySelector('#clear-filters')
  .addEventListener('click', () => {
    statusFilter.value = 'all';
    fitFilter.value = 'all';

    render();
  });

initialise();
render();
