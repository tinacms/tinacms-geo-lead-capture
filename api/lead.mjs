// Captures a lead: adds the email to a Mailchimp audience and sends the report
// via SendGrid (inline HTML). Both steps are optional — unset env vars just skip
// that step, so the user's flow never breaks (e.g. in local dev).
// Env: MAILCHIMP_API_KEY (form key-usX), MAILCHIMP_AUDIENCE_ID,
//      SENDGRID_API_KEY, LEAD_FROM_EMAIL (defaults to hello@tina.io).

const json = (res, status, body) => {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

const isEmail = (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

// Public URL the tool is served from (behind tina.io's /geo proxy in prod).
const appUrl = () => (process.env.APP_URL || 'https://tina.io/geo').replace(/\/$/, '');

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

// Smooth score colour, matching the app: 0 red -> ~54 yellow -> 75+ green.
const scoreColor = (n) => {
  const t = Math.max(0, Math.min(100, Number(n) || 0));
  const stops = [
    [0, 2],
    [33, 42],
    [75, 62],
    [100, 138],
  ];
  let hue = stops[stops.length - 1][1];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [x0, h0] = stops[i - 1];
      const [x1, h1] = stops[i];
      hue = h0 + (h1 - h0) * ((t - x0) / (x1 - x0));
      break;
    }
  }
  return `hsl(${Math.round(hue)},70%,40%)`;
};

const emailHtml = (r) => {
  const cats = (r.categories || [])
    .map(
      (c) =>
        `<tr><td style="padding:6px 0;color:#334155;font-size:14px">${esc(c.title)}</td><td style="padding:6px 0;text-align:right;font-weight:700;font-size:14px;color:${scoreColor(c.score)}">${Number(c.score)}</td></tr>`,
    )
    .join('');
  const fixes = (r.topFixes || [])
    .map(
      (f) =>
        `<li style="margin:0 0 10px"><strong style="color:#0f172a">${esc(f.label)}</strong><br><span style="color:#64748b;font-size:14px">${esc(f.why)}</span></li>`,
    )
    .join('');
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 0"><tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
      <tr><td style="padding:32px 32px 8px">
        <p style="margin:0 0 4px;color:#64748b;font-size:12px;letter-spacing:.06em;text-transform:uppercase">AI Search Readiness</p>
        <h1 style="margin:0;font-size:22px;color:#0f172a">Your report for ${esc(r.url)}</h1>
      </td></tr>
      <tr><td style="padding:16px 32px">
        <span style="font-size:56px;font-weight:800;line-height:1;color:${scoreColor(r.overall)}">${Number(r.overall)}</span><span style="font-size:20px;color:#94a3b8">/100</span>
        <span style="margin-left:12px;font-size:15px;color:#334155">Grade ${esc(r.grade)} &middot; ${Number(r.passCount)}/${Number(r.totalScored)} checks passed</span>
      </td></tr>
      <tr><td style="padding:8px 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cats}</table></td></tr>
      ${fixes ? `<tr><td style="padding:16px 32px 8px"><h2 style="margin:0 0 12px;font-size:16px;color:#0f172a">Top fixes</h2><ol style="margin:0;padding-left:18px">${fixes}</ol></td></tr>` : ''}
      <tr><td style="padding:24px 32px 32px"><a href="${appUrl()}/?url=${encodeURIComponent(r.url || '')}&full=1" style="display:inline-block;background:#d13f13;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:6px">See your full report</a></td></tr>
      <tr><td style="padding:16px 32px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px">Free tool by TinaCMS. You received this because you requested the report.</td></tr>
    </table>
  </td></tr></table></body></html>`;
};

async function addToMailchimp(email, note) {
  const apiKey = process.env.MAILCHIMP_API_KEY;
  const audienceId = process.env.MAILCHIMP_AUDIENCE_ID;
  const prefix = apiKey?.split('-')[1];
  if (!apiKey || !audienceId || !prefix) {
    return false;
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
          ...(note ? { merge_fields: {} } : {}),
        }),
      },
    );
    // 400 "Member Exists" still means they're on the list.
    return r.ok || r.status === 400;
  } catch {
    return false;
  }
}

async function sendReport(email, report) {
  const key = process.env.SENDGRID_API_KEY;
  if (!key || !report) {
    return false;
  }
  // Falls back to tina.io's own SendGrid sender var so it works with that env as-is.
  const from = process.env.LEAD_FROM_EMAIL || process.env.SENDGRID_FROM_EMAIL || 'sophiebelle@ssw.com.au';
  const fromName = process.env.LEAD_FROM_NAME || 'The TinaCMS Team';
  const replyTo = process.env.LEAD_REPLY_TO;
  try {
    const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email }] }],
        from: { email: from, name: fromName },
        ...(replyTo ? { reply_to: { email: replyTo } } : {}),
        subject: `Your AI Search Readiness report — ${Number(report.overall)}/100`,
        content: [{ type: 'text/html', value: emailHtml(report) }],
      }),
    });
    return r.ok; // SendGrid returns 202 Accepted
  } catch {
    return false;
  }
}

// HubSpot — accepts EITHER credential an admin can provide:
//   1. HUBSPOT_TOKEN  -> Private App/Service Key token, Contacts API upsert (preferred)
//   2. HUBSPOT_PORTAL_ID + HUBSPOT_FORM_GUID -> Forms API no-auth submit
// Whichever env is set wins; unset = skip cleanly. Idempotent by email.
// The analysed URL goes in the custom `analyzed_url` property (NOT the standard
// `website`, which HubSpot uses to auto-associate a Company). `lead_source`
// marks the campaign for sales segmentation.
async function sendToHubspot(email, phone, website) {
  const token = process.env.HUBSPOT_TOKEN;
  const portalId = process.env.HUBSPOT_PORTAL_ID;
  const formGuid = process.env.HUBSPOT_FORM_GUID;
  try {
    if (token) {
      const properties = { email, lead_source: 'AI Search Readiness Tool' };
      if (phone) properties.phone = phone;
      if (website) properties.analyzed_url = website;
      const r = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: [{ idProperty: 'email', id: email, properties }] }),
      });
      return r.ok;
    }
    if (portalId && formGuid) {
      const fields = [{ name: 'email', value: email }];
      if (phone) fields.push({ name: 'phone', value: phone });
      const r = await fetch(
        `https://api.hsforms.com/submissions/v3/integration/submit/${portalId}/${formGuid}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields,
            context: { pageName: 'AI Search Readiness' },
          }),
        },
      );
      return r.ok;
    }
    return false;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed.' });
  }

  let email;
  let note = '';
  let report = null;
  let phone = '';
  let website = '';
  try {
    const body =
      typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}');
    email = body.email;
    note = typeof body.note === 'string' ? body.note.slice(0, 500) : '';
    report = body.report && typeof body.report === 'object' ? body.report : null;
    phone = typeof body.phone === 'string' ? body.phone.slice(0, 40) : '';
    website = typeof body.website === 'string' ? body.website.slice(0, 300) : '';
  } catch {
    return json(res, 400, { error: 'Invalid request.' });
  }
  if (!isEmail(email)) {
    return json(res, 400, { error: 'Enter a valid email address.' });
  }

  // All best-effort — never hold the user's report hostage to a CRM/ESP.
  const [stored, sent, hubspot] = await Promise.all([
    addToMailchimp(email, note),
    sendReport(email, report),
    sendToHubspot(email, phone, website),
  ]);

  return json(res, 200, { ok: true, stored, sent, hubspot });
}
