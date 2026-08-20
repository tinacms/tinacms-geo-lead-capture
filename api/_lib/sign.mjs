// Signs the slice of a report that /api/lead is allowed to email.
//
// Without this, `report` is just a request body: anyone can POST /api/lead with
// an arbitrary recipient and arbitrary text and have it sent from our verified
// SendGrid sender, with our branding. Signing at /api/analyze and verifying at
// /api/lead means the only reports we ever email are ones we generated.

import { createHmac, timingSafeEqual } from 'node:crypto';

// REPORT_SIGNING_SECRET is the intended key. It falls back to SENDGRID_API_KEY
// so this works with the env as-is — both functions already have it, and a
// deploy that landed before someone set a new var would otherwise silently stop
// emailing reports. ponytail: key reuse, set REPORT_SIGNING_SECRET to split them.
const key = () => process.env.REPORT_SIGNING_SECRET || process.env.SENDGRID_API_KEY || '';

// Exactly the fields the email renders, in a fixed order. Nested arrays rather
// than objects so the signature can't depend on JSON key ordering.
const canonical = (r) =>
  JSON.stringify([
    String(r.url ?? ''),
    Number(r.overall) || 0,
    String(r.grade ?? ''),
    Number(r.passCount) || 0,
    Number(r.totalScored) || 0,
    (r.categories || []).map((c) => [String(c.title ?? ''), Number(c.score) || 0]),
    (r.topFixes || []).map((f) => [String(f.label ?? ''), String(f.why ?? '')]),
  ]);

// The subset of a full analyze report that may be emailed. /api/analyze returns
// this verbatim alongside its signature so the client never rebuilds it — any
// re-derivation would be a chance for the two sides to disagree.
export const emailReport = (r) => ({
  url: r.finalUrl || r.url,
  overall: r.overall,
  grade: r.grade,
  passCount: r.passCount,
  totalScored: r.totalScored,
  categories: (r.categories || []).map((c) => ({ title: c.title, score: c.score })),
  topFixes: (r.topFixes || []).map((f) => ({ label: f.label, why: f.why })),
});

export const signReport = (r) => {
  const k = key();
  return k ? createHmac('sha256', k).update(canonical(r)).digest('hex') : null;
};

export const verifyReport = (r, sig) => {
  // A missing report is now a rejection, so this is a real code path, not a
  // defensive one.
  if (!r || typeof r !== 'object') {
    return false;
  }
  const expected = signReport(r);
  // No key means nothing can be trusted, so nothing verifies. The length check
  // is what makes timingSafeEqual safe to call — it throws on a mismatch.
  if (!expected || typeof sig !== 'string' || sig.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
};
