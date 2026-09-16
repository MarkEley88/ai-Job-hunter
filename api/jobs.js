async function handler(req, res) {
  // Allow requests from your GitHub Pages app
  res.setHeader(
    'Access-Control-Allow-Origin',
    'https://markeley88.github.io'
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle browser CORS preflight
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;

  if (!appId || !appKey) {
    res.status(500).json({
      error: 'Adzuna API credentials are not configured on the server.'
    });
    return;
  }

  const query = req.query || {};

  // Support comma-separated titles, e.g.:
  // "Head of Operations, Head of Transformation, COO"
  const keywords = String(query.keywords || 'Head of Operations')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

  const location = String(query.location || 'London').trim();

  // Support both the current frontend parameter and the original API name.
  const salary = Number(query.minSalary ?? query.salary ?? 0);

  // Keep the first useful location from inputs such as
  // "UK / London / Hybrid"
  let where = location;

  if (
    /^(uk|united kingdom)$/i.test(location) ||
    /uk\s*\/\s*london\s*\/\s*hybrid/i.test(location)
  ) {
    where = 'London';
  }

  if (where) {
    where = where.split('/')[0].trim();
  }

  // Search Adzuna separately for each title, then combine the results.
  async function searchAdzuna(keyword) {
    const params = new URLSearchParams();

    params.set('app_id', appId);
    params.set('app_key', appKey);
    params.set('results_per_page', '30');
    params.set('what', keyword);
    params.set('sort_by', 'date');

    if (salary > 0) {
      params.set('salary_min', String(salary));
    }

    if (where) {
      params.set('where', where);
    }

    const adzunaUrl =
      'https://api.adzuna.com/v1/api/jobs/gb/search/1?' +
      params.toString();

    const response = await fetch(adzunaUrl, {
      headers: { Accept: 'application/json' }
    });

    const responseText = await response.text();

    let data;

    try {
      data = JSON.parse(responseText);
    } catch {
      throw new Error(
        `Adzuna returned an invalid response for "${keyword}".`
      );
    }

    if (!response.ok) {
      throw new Error(
        `Adzuna rejected the "${keyword}" search (${response.status}).`
      );
    }

    return data.results || [];
  }

  try {
    const resultSets = await Promise.all(
      keywords.map(keyword => searchAdzuna(keyword))
    );

    // Merge all title searches and remove duplicate adverts.
    const seen = new Set();
    const jobs = [];

    for (const resultSet of resultSets) {
      for (const [index, job] of resultSet.entries()) {
        const uniqueKey =
          job.id ||
          job.redirect_url ||
          `${job.title || ''}|${job.company?.display_name || ''}`;

        if (seen.has(uniqueKey)) continue;
        seen.add(uniqueKey);

        jobs.push({
          id: `adzuna-${job.id || Date.now() + jobs.length + index}`,
          title: job.title || 'Untitled role',
          company:
            job.company && job.company.display_name
              ? job.company.display_name
              : 'Unknown company',
          location:
            job.location && job.location.display_name
              ? job.location.display_name
              : 'UK',
          salary: formatSalary(job.salary_min, job.salary_max),
          bonus: '',
          url: job.redirect_url || '',
          status: 'Interested',
          description: stripHtml(job.description || ''),
          source: 'Adzuna',
          created: job.created || '',
          salaryMin:
            typeof job.salary_min === 'number'
              ? job.salary_min
              : null,
          salaryMax:
            typeof job.salary_max === 'number'
              ? job.salary_max
              : null
        });
      }
    }

    res.status(200).json({
      count: jobs.length,
      jobs
    });
  } catch (error) {
    res.status(502).json({
      error: 'Unable to search Adzuna.',
      details:
        error && error.message
          ? error.message
          : String(error)
    });
  }
}

function formatSalary(min, max) {
  if (typeof min === 'number' && typeof max === 'number') {
    return `£${Math.round(min).toLocaleString()} – £${Math.round(max).toLocaleString()}`;
  }

  if (typeof min === 'number') {
    return `£${Math.round(min).toLocaleString()}+`;
  }

  if (typeof max === 'number') {
    return `Up to £${Math.round(max).toLocaleString()}`;
  }

  return 'Salary not disclosed';
}

function stripHtml(text) {
  return String(text)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// IMPORTANT:
// Vercel is currently treating api/jobs.js as CommonJS,
// so DO NOT use "export default".
module.exports = handler;
