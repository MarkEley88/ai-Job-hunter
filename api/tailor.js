export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'AI tailoring is not enabled yet. Add OPENAI_API_KEY to the Vercel project environment variables, then redeploy.' });
    return;
  }

  const { title, company, description, cv } = req.body || {};
  if (!title || !cv) { res.status(400).json({ error: 'A job title and CV are required.' }); return; }

  const prompt = `You are a senior UK financial-services recruitment specialist. Tailor an application for this candidate without inventing experience, qualifications, employers, metrics or achievements.

TARGET ROLE: ${title}
COMPANY: ${company || 'Not specified'}
JOB DESCRIPTION: ${description || 'Not provided'}

CANDIDATE CV:
${cv}

Return ONLY valid JSON with these keys:
positioning: concise paragraph explaining how the candidate should position themselves;
cvChanges: array of 5-8 specific CV edits;
evidence: array of 5-8 pieces of evidence from the CV that should be emphasised;
profile: a polished 100-150 word professional profile tailored to the role;
coverLetter: a concise 250-350 word cover letter;
interviewQuestions: array of 6 likely role-specific interview questions.

If the CV lacks evidence for something requested by the role, explicitly say so rather than inventing it.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5-mini',
        messages: [{ role: 'system', content: 'You produce accurate job-application material. Never fabricate candidate facts.' }, { role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.3
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `OpenAI request failed (${response.status}).`);
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('The AI returned no application content.');
    res.status(200).json(JSON.parse(content));
  } catch (error) {
    res.status(502).json({ error: error.message || 'Unable to generate tailored application.' });
  }
}
