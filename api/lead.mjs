// Captures a lead: adds the email to a Mailchimp audience and sends the report
// via SendGrid (inline HTML). Both steps are optional — unset env vars just skip
// that step, so the user's flow never breaks (e.g. in local dev).
// Env: MAILCHIMP_API_KEY (form key-usX), MAILCHIMP_AUDIENCE_ID,
//      SENDGRID_API_KEY, LEAD_FROM_EMAIL (defaults to hello@tina.io).

import { verifyReport } from './_lib/sign.mjs';

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

// Brand fonts (styles.css --font-head / --font-body) with the usual email fallbacks —
// clients won't load the webfonts, so the fallback chain is what most people see.
const HEAD_FONT = `'IBM Plex Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif`;
const BODY_FONT = `'Inter',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif`;

const reportUrl = (url) => `${appUrl()}/?url=${encodeURIComponent(url || '')}&full=1`;

export const emailHtml = (r) => {
  const cats = (r.categories || [])
    .map(
      (c) =>
        `<tr><td style="padding:7px 0;border-bottom:1px solid #f1f5f9;color:#334155;font-size:14px">${esc(c.title)}</td><td style="padding:7px 0;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:600;font-size:14px;color:${scoreColor(c.score)}">${Number(c.score)}</td></tr>`,
    )
    .join('');
  const fixes = (r.topFixes || [])
    .map(
      (f) =>
        `<li style="margin:0 0 12px"><strong style="color:#0f172a;font-weight:600">${esc(f.label)}</strong><br><span style="color:#64748b;font-size:14px">${esc(f.why)}</span></li>`,
    )
    .join('');
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>Your AI Search Readiness report</title>
<style>@media (max-width:600px){.card{width:100%!important}.px{padding-left:20px!important;padding-right:20px!important}.score{font-size:44px!important}}</style>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:${BODY_FONT};color:#0f172a;line-height:1.5">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${Number(r.overall)}/100 &mdash; grade ${esc(r.grade)}, ${Number(r.passCount)} of ${Number(r.totalScored)} checks passed.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:24px 12px"><tr><td align="center">
    <table role="presentation" class="card" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
      <tr><td class="px" style="padding:20px 32px;border-bottom:1px solid #e2e8f0">
        <a href="https://tina.io"><img src="${appUrl()}/tina-logo-email.png" alt="TinaCMS" width="128" height="36" style="display:block;border:0;width:128px;height:36px"></a>
      </td></tr>
      <tr><td class="px" style="padding:32px 32px 8px">
        <p style="margin:0 0 6px;font-family:${HEAD_FONT};color:#64748b;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase">AI Search Readiness</p>
        <h1 style="margin:0;font-family:${HEAD_FONT};font-size:22px;font-weight:600;color:#14141a;word-break:break-word">Your report for ${esc(r.url)}</h1>
      </td></tr>
      <tr><td class="px" style="padding:16px 32px">
        <span class="score" style="font-family:${HEAD_FONT};font-size:56px;font-weight:700;line-height:1;color:${scoreColor(r.overall)}">${Number(r.overall)}</span><span style="font-size:20px;color:#94a3b8">/100</span>
        <span style="margin-left:12px;font-size:15px;color:#334155">Grade ${esc(r.grade)} &middot; ${Number(r.passCount)}/${Number(r.totalScored)} checks passed</span>
      </td></tr>
      <tr><td class="px" style="padding:8px 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cats}</table></td></tr>
      ${fixes ? `<tr><td class="px" style="padding:24px 32px 8px"><h2 style="margin:0 0 12px;font-family:${HEAD_FONT};font-size:16px;font-weight:600;color:#14141a">Top fixes</h2><ol style="margin:0;padding-left:18px">${fixes}</ol></td></tr>` : ''}
      <tr><td class="px" style="padding:24px 32px 32px">
        <a href="${reportUrl(r.url)}" style="display:inline-block;background:#ec4815;background-image:linear-gradient(to bottom right,#ff724b,#d13f13);color:#fff;text-decoration:none;font-family:${HEAD_FONT};font-weight:600;font-size:16px;padding:14px 28px;border-radius:999px">See your full report</a>
      </td></tr>
      <tr><td class="px" align="center" style="padding:24px 32px 28px;border-top:1px solid #e2e8f0;background:#f8fafc">
        <p style="margin:0 0 10px;color:#64748b;font-size:14px">The open-source, Git-backed headless CMS.</p>
        <p style="margin:0 0 14px;font-size:14px">
          <a href="https://tina.io" style="color:#1d2c6c;text-decoration:none;font-weight:500">tina.io</a>
          <span style="color:#cbd5e1">&nbsp;&middot;&nbsp;</span>
          <a href="https://tina.io/docs" style="color:#1d2c6c;text-decoration:none;font-weight:500">Docs</a>
          <span style="color:#cbd5e1">&nbsp;&middot;&nbsp;</span>
          <a href="https://github.com/tinacms/tinacms" style="color:#1d2c6c;text-decoration:none;font-weight:500">GitHub</a>
        </p>
        <p style="margin:0;color:#94a3b8;font-size:12px">Free tool by TinaCMS. You received this because you requested the report.</p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
};

// Plain-text alternative — HTML-only transactional mail scores worse with spam filters.
export const emailText = (r) => {
  const cats = (r.categories || []).map((c) => `  ${c.title}: ${Number(c.score)}`).join('\n');
  const fixes = (r.topFixes || []).map((f, i) => `  ${i + 1}. ${f.label} — ${f.why}`).join('\n');
  return (
    `Your AI Search Readiness report for ${r.url}\n\n` +
    `${Number(r.overall)}/100 — grade ${r.grade}, ${Number(r.passCount)}/${Number(r.totalScored)} checks passed.\n\n` +
    `${cats}\n` +
    (fixes ? `\nTop fixes:\n${fixes}\n` : '') +
    `\nSee your full report: ${reportUrl(r.url)}\n\n` +
    `Free tool by TinaCMS (https://tina.io). You received this because you requested the report.\n`
  );
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
        // SendGrid requires text/plain before text/html.
        content: [
          { type: 'text/plain', value: emailText(report) },
          { type: 'text/html', value: emailHtml(report) },
        ],
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
  let sig = '';
  let phone = '';
  let website = '';
  try {
    const body =
      typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}');
    email = body.email;
    note = typeof body.note === 'string' ? body.note.slice(0, 500) : '';
    report = body.report && typeof body.report === 'object' ? body.report : null;
    sig = typeof body.sig === 'string' ? body.sig : '';
    phone = typeof body.phone === 'string' ? body.phone.slice(0, 40) : '';
    website = typeof body.website === 'string' ? body.website.slice(0, 300) : '';
  } catch {
    return json(res, 400, { error: 'Invalid request.' });
  }
  if (!isEmail(email)) {
    return json(res, 400, { error: 'Enter a valid email address.' });
  }
  // We only email reports we generated. Anything else is someone using our
  // sender to deliver their own text, so refuse the whole request rather than
  // quietly dropping the report and still touching the CRM.
  if (report && !verifyReport(report, sig)) {
    return json(res, 400, { error: 'Invalid request.' });
  }

  // All best-effort — never hold the user's report hostage to a CRM/ESP.
  const [stored, sent, hubspot] = await Promise.all([
    addToMailchimp(email, note),
    sendReport(email, report),
    sendToHubspot(email, phone, website),
  ]);

  return json(res, 200, { ok: true, stored, sent, hubspot });
}
