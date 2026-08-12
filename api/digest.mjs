// Weekly sales digest. Vercel cron hits this (see vercel.json crons); it pulls
// HubSpot contacts stamped `lead_source = AI Search Readiness Tool` created in
// the last 7 days and emails the list to sales via SendGrid.
// Env: HUBSPOT_TOKEN (needs crm.objects.contacts.READ scope), SENDGRID_API_KEY,
//      DIGEST_TO (comma-separated recipients), optional CRON_SECRET,
//      LEAD_FROM_EMAIL / LEAD_FROM_NAME (shared with lead.mjs).
// Run manually: GET /api/digest?days=30 (add &secret=... if CRON_SECRET set).

const LEAD_SOURCE = 'AI Search Readiness Tool';

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

async function fetchLeads(token, sinceMs) {
  const r = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [
            { propertyName: 'lead_source', operator: 'EQ', value: LEAD_SOURCE },
            { propertyName: 'createdate', operator: 'GTE', value: String(sinceMs) },
          ],
        },
      ],
      properties: ['email', 'phone', 'analyzed_url', 'createdate'],
      sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
      limit: 100,
    }),
  });
  if (!r.ok) throw new Error(`HubSpot search ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return (data.results || []).map((c) => c.properties);
}

function digestHtml(leads, days) {
  const rows = leads
    .map(
      (l) =>
        `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:14px">${esc(l.email)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:14px">${esc(l.phone || '—')}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:14px">${esc(l.analyzed_url || '—')}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:14px;color:#64748b">${esc((l.createdate || '').slice(0, 10))}</td>
        </tr>`,
    )
    .join('');
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 0"><tr><td align="center">
    <table role="presentation" width="720" cellpadding="0" cellspacing="0" style="max-width:720px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
      <tr><td style="padding:28px 28px 8px">
        <p style="margin:0 0 4px;color:#64748b;font-size:12px;letter-spacing:.06em;text-transform:uppercase">AI Search Readiness</p>
        <h1 style="margin:0;font-size:20px">${leads.length} new lead${leads.length === 1 ? '' : 's'} in the last ${days} days</h1>
      </td></tr>
      <tr><td style="padding:16px 28px 28px">
        ${
          leads.length
            ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
                <tr style="text-align:left;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.04em">
                  <th style="padding:8px 12px;border-bottom:2px solid #e2e8f0">Email</th>
                  <th style="padding:8px 12px;border-bottom:2px solid #e2e8f0">Phone</th>
                  <th style="padding:8px 12px;border-bottom:2px solid #e2e8f0">Analyzed URL</th>
                  <th style="padding:8px 12px;border-bottom:2px solid #e2e8f0">Created</th>
                </tr>${rows}
              </table>`
            : `<p style="margin:0;color:#64748b;font-size:14px">No new leads this period.</p>`
        }
      </td></tr>
      <tr><td style="padding:16px 28px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px">Automated weekly digest from the AI Search Readiness tool.</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

async function sendDigest(to, leads, days) {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) throw new Error('SENDGRID_API_KEY not set');
  const from = process.env.LEAD_FROM_EMAIL || process.env.SENDGRID_FROM_EMAIL || 'sophiebelle@ssw.com.au';
  const fromName = process.env.LEAD_FROM_NAME || 'The TinaCMS Team';
  const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: to.map((email) => ({ email })) }],
      from: { email: from, name: fromName },
      subject: `AI Search Readiness — ${leads.length} lead${leads.length === 1 ? '' : 's'} this week`,
      content: [{ type: 'text/html', value: digestHtml(leads, days) }],
    }),
  });
  if (!r.ok) throw new Error(`SendGrid ${r.status}: ${await r.text()}`);
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.authorization === `Bearer ${secret}`;
    const q = new URL(req.url, 'http://x').searchParams.get('secret') === secret;
    if (!auth && !q) return res.status(401).end('Unauthorized');
  }

  const token = process.env.HUBSPOT_TOKEN;
  const to = (process.env.DIGEST_TO || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!token) return res.status(500).end('HUBSPOT_TOKEN not set');
  if (!to.length) return res.status(500).end('DIGEST_TO not set');

  const days = Math.min(90, Math.max(1, Number(new URL(req.url, 'http://x').searchParams.get('days')) || 7));
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;

  try {
    const leads = await fetchLeads(token, sinceMs);
    await sendDigest(to, leads, days);
    res.status(200).setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, count: leads.length, to }));
  } catch (e) {
    res.status(502).setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
  }
}
