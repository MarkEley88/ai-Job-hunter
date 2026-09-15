export default async function handler(request, response) {
  // Allow the GitHub Pages frontend to call this API.
  response.setHeader(
    'Access-Control-Allow-Origin',
    'https://markeley88.github.io'
  );
  response.setHeader(
    'Access-Control-Allow-Methods',
    'GET, OPTIONS'
  );
  response.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type'
  );

  if (request.method === 'OPTIONS') {
    return response.status(204).end();
  }

  if (request.method !== 'GET') {
    return response.status(405).json({
      error: 'Method not allowed.'
    });
  }

  const {
    ADZUNA_APP_ID,
    ADZUNA_APP_KEY
  } = process.env;

  if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) {
    return response.status(500).json({
      error: 'Adzuna API credentials are not configured on the server.'
    });
  }

  const params = request.query || {};

  const keywords = String(
    params.keywords ||
    'Head of Operations'
  ).trim();

  const location = String(
    params.location ||
    'London'
  ).trim();

  const salary = Math.max(
    0,
    Number(params.salary || 0) || 0
  );

  /*
   * Adzuna UK search endpoint.
   *
   * We deliberately build the URL using URLSearchParams
   * so that spaces and other characters are encoded correctly.
   */
  const adzunaUrl = new URL(
    'https://api.adzuna.com/v1/api/jobs/gb/search/1'
  );

  adzunaUrl.searchParams.set(
    'app_id',
    ADZUNA_APP_ID
  );

  adzunaUrl.searchParams.set(
    'app_key',
    ADZUNA_APP_KEY
  );

  adzunaUrl.searchParams.set(
    'results_per_page',
    '30'
  );

  adzunaUrl.searchParams.set(
    'what',
    keywords
  );

  adzunaUrl.searchParams.set(
    'sort_by',
    'date'
  );

  if (salary > 0) {
    adzunaUrl.searchParams.set(
      'salary_min',
      String(salary)
    );
  }

  /*
   * Convert our friendly location values into
   * an Adzuna location search.
   */
  if (location) {
    let where = location;

    if (
      /^(uk|united kingdom)$/i.test(location)
    ) {
      where = 'London';
    } else if (
      /uk\s*\/\s*london\s*\/\s*hybrid/i.test(location)
    ) {
      where = 'London';
    } else {
      where = location
        .split('/')
        [0]
        .trim();
    }

    if (where) {
      adzunaUrl.searchParams.set(
        'where',
        where
      );
    }
  }

  try {
    const upstream = await fetch(
      adzunaUrl.toString(),
      {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        }
      }
    );

    /*
     * Read the response as text first.
     *
     * This is important because if Adzuna/Vercel returns
     * HTML instead of JSON, response.json() would itself
     * throw an unhelpful "Unexpected token <" error.
     */
    const rawBody = await upstream.text();

    let data;

    try {
      data = JSON.parse(rawBody);
    } catch {
      return response.status(502).json({
        error: 'Adzuna returned a non-JSON response.',
        adzunaStatus: upstream.status,
        details: rawBody
          .replace(/\s+/g, ' ')
          .slice(0, 500)
      });
    }

    if (!upstream.ok) {
      return response.status(502).json({
        error: 'Adzuna search failed.',
        adzunaStatus: upstream.status,
        details: data
      });
    }

    const jobs = (data.results || []).map(
      job => ({
        id: job.id,

        title:
          job.title || '',

        company:
          job.company?.display_name ||
          'Unknown company',

        location:
          job.location?.display_name ||
          'UK',

        salary:
          formatSalary(
            job.salary_min,
            job.salary_max
          ),

        salaryMin:
          Number(job.salary_min) || 0,

        salaryMax:
          Number(job.salary_max) || 0,

        bonus: '',

        url:
          job.redirect_url || '',

        status:
          'Interested',

        description:
          stripHtml(
            job.description || ''
          ),

        created:
          job.created || ''
      })
    );

    return response.status(200).json({
      count: jobs.length,
      jobs
    });

  } catch (error) {
    return response.status(502).json({
      error: 'Unable to reach Adzuna.',
      details:
        error instanceof Error
          ? error.message
          : String(error)
    });
  }
}


/*
 * Convert Adzuna salary values into a readable
 * UK salary string.
 */
function formatSalary(min, max) {
  const minimum =
    Number(min) || 0;

  const maximum =
    Number(max) || 0;

  if (!minimum && !maximum) {
    return 'Salary not disclosed';
  }

  if (minimum && !maximum) {
    return `£${Math.round(
      minimum
    ).toLocaleString('en-GB')}`;
  }

  if (!minimum && maximum) {
    return `Up to £${Math.round(
      maximum
    ).toLocaleString('en-GB')}`;
  }

  if (minimum === maximum) {
    return `£${Math.round(
      minimum
    ).toLocaleString('en-GB')}`;
  }

  return `£${Math.round(
    minimum
  ).toLocaleString('en-GB')} – £${Math.round(
    maximum
  ).toLocaleString('en-GB')}`;
}


/*
 * Remove HTML from Adzuna descriptions.
 */
function stripHtml(value) {
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  }    if (where) {
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
