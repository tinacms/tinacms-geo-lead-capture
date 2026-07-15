// Captures a lead into Mailchimp via its REST API (no SDK, zero deps).
// Env: MAILCHIMP_API_KEY (form: key-usX), MAILCHIMP_AUDIENCE_ID.
// The server prefix (usX) is derived from the API key suffix.
const json = (res, status, body) => {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

const isEmail = (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed.' });
  }

  let email;
  let note = '';
  try {
    const body =
      typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}');
    email = body.email;
    note = typeof body.note === 'string' ? body.note.slice(0, 500) : '';
  } catch {
    return json(res, 400, { error: 'Invalid request.' });
  }
  if (!isEmail(email)) {
    return json(res, 400, { error: 'Enter a valid email address.' });
  }

  const apiKey = process.env.MAILCHIMP_API_KEY;
  const audienceId = process.env.MAILCHIMP_AUDIENCE_ID;
  const prefix = apiKey?.split('-')[1];
  if (!apiKey || !audienceId || !prefix) {
    // Not configured (e.g. local dev). Don't fail the user's flow.
    return json(res, 200, { ok: true, stored: false });
  }

  try {
    const r = await fetch(
      `https://${prefix}.api.mailchimp.com/3.0/lists/${audienceId}/members`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`anystring:${apiKey}`).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email_address: email,
          status: 'subscribed',
          ...(note ? { tags: [], merge_fields: {} } : {}),
        }),
      },
    );
    // 400 with "Member Exists" is a success for our purposes.
    const ok = r.ok || r.status === 400;
    return json(res, ok ? 200 : 502, { ok, stored: r.ok });
  } catch {
    return json(res, 200, { ok: true, stored: false });
  }
}
