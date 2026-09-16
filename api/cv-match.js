export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'CV matching is not enabled yet. Add OPENAI_API_KEY to the Vercel project environment variables, then redeploy.' });
    return;
  }

  const { title, company, description, cv } = req.body || {};
  if (!title || !cv || !description) {
    res.status(400).json({ error: 'A job title, job description and CV are required.' });
    return;
  }

  const prompt = `You are a rigorous UK financial-services recruitment assessor. Compare the candidate CV against the actual requirements in the job description. Do not reward generic similarity and do not invent experience, qualifications, achievements or skills.

TARGET ROLE: ${title}
COMPANY: ${company || 'Not specified'}

JOB DESCRIPTION:
${description}

CANDIDATE CV:
${cv}

Identify the meaningful requirements in the job description, prioritising explicit essential/must-have requirements and then preferred requirements. Combine duplicate requirements. For each requirement, classify the candidate as matched, partial, or missing based ONLY on evidence explicitly present in the CV. A requirement is matched only when the CV provides credible direct evidence; partial means related/transferable evidence exists but the requirement is not fully evidenced; missing means there is no credible evidence in the CV. Do not assume that job seniority alone proves a skill.

Calculate matchedCount as the number classified matched, partialCount as the number classified partial, missingCount as the number classified missing, and requirementCount as their total. Calculate overallScore as a percentage based on weighted coverage: matched = 1, partial = 0.5, missing = 0, with essential requirements receiving double weight when the job description clearly marks them as essential/must-have/required. Round overallScore to the nearest whole number.

Return ONLY valid JSON with these keys:
overallScore: integer 0-100;
matchedCount: integer;
partialCount: integer;
missingCount: integer;
requirementCount: integer;
summary: concise 1-2 sentence assessment;
matched: array of objects with requirement and evidence;
partial: array of objects with requirement and evidence;
missing: array of objects with requirement and whyMissing;
priorityGaps: array of up to 5 missing or partial requirements that would matter most to an application;
transferableStrengths: array of up to 5 relevant strengths evidenced by the CV.

Keep requirements specific and useful, not trivial wording such as 'good communication'. Never fabricate evidence. If the job description is vague, assess only requirements that can reasonably be identified from it.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5-mini',
        messages: [
          { role: 'system', content: 'You produce evidence-based recruitment assessments. Never fabricate candidate evidence.' },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `OpenAI request failed (${response.status}).`);
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('The AI returned no CV matching result.');
    const result = JSON.parse(content);
    res.status(200).json(result);
  } catch (error) {
    res.status(502).json({ error: error.message || 'Unable to score the CV against this role.' });
  }
}
