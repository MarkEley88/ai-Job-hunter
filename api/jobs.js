export default async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Origin', 'https://markeley88.github.io');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') {
    return response.status(204).end();
  }

  const { ADZUNA_APP_ID, ADZUNA_APP_KEY } = process.env;

  if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) {
    return response.status(500).json({
      error: 'Adzuna API credentials are not configured on the server.'
    });
  }

  const params = request.query || {};
  const what = String(params.keywords || 'Head of Operations, Head of Transformation, COO').trim();
  const whereInput = String(params.location || '').trim();
  const salaryMin = Math.max(0, Number(params.salary || 120000) || 0);

  const url = new URL('https://api.adzuna.com/v1/api/jobs/gb/search/1');
  url.searchParams.set('app_id', ADZUNA_APP_ID);
  url.searchParams.set('app_key', ADZUNA_APP_KEY);
  url.searchParams.set('results_per_page', '30');
  url.searchParams.set('what', what.replace(/,/g, ' '));
  url.searchParams.set('salary_min', String(salaryMin));
  url.searchParams.set('sort_by', 'date');
  url.searchParams.set('content-type', 'application/json');

  if (
    whereInput &&
    !/^(uk|united kingdom|uk\s*\/\s*london\s*\/\s*hybrid)$/i.test(whereInput)
  ) {
    const where = whereInput.split('/')[0].trim();
    if (where) {
      url.searchParams.set('where', where);
    }
  } else if (/london/i.test(whereInput)) {
    url.searchParams.set('where', 'london');
  }

  try {
    const upstream = await fetch(url);
    const data = await upstream.json();

    if (!upstream.ok) {
      return response.status(upstream.status).json({
        error: 'Adzuna search failed.',
        details: data
      });
    }

    const jobs = (data.results || []).map(job => ({
      id: job.id,
      title: job.title || '',
      company: job.company?.display_name || 'Unknown company',
      location: job.location?.display_name || 'UK',
      salary: formatSalary(job.salary_min, job.salary_max),
      salaryMin: job.salary_min || 0,
      salaryMax: job.salary_max || 0,
      bonus: '',
      url: job.redirect_url || '',
      status: 'Interested',
      description: stripHtml(job.description || ''),
      created: job.created || ''
    }));

    return response.status(200).json({
      count: jobs.length,
      jobs
    });
  } catch (error) {
    return response.status(502).json({
      error: 'Unable to reach Adzuna.',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

function formatSalary(min, max) {
  const values = [min, max].filter(value => Number(value) > 0);

  if (!values.length) {
    return 'Salary not disclosed';
  }

  if (values.length === 1) {
    return `£${Math.round(values[0]).toLocaleString('en-GB')}`;
  }

  return `£${Math.round(values[0]).toLocaleString('en-GB')} – £${Math.round(values[1]).toLocaleString('en-GB')}`;
}

function stripHtml(value) {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
