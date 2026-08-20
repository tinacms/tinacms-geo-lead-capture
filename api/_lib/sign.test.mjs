import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emailReport, signReport, verifyReport } from './sign.mjs';

process.env.REPORT_SIGNING_SECRET = 'test-secret';

const report = {
  finalUrl: 'https://example.com/pricing',
  overall: 64,
  grade: 'C',
  passCount: 14,
  totalScored: 22,
  categories: [{ id: 'crawl', title: 'Crawlability', score: 82, checks: [] }],
  topFixes: [{ label: 'Add an FAQ block', why: 'Answer engines quote Q&A markup.', rule: 'x' }],
};

test('emailReport keeps only what the email renders', () => {
  const r = emailReport(report);
  assert.deepEqual(Object.keys(r), [
    'url',
    'overall',
    'grade',
    'passCount',
    'totalScored',
    'categories',
    'topFixes',
  ]);
  assert.equal(r.url, 'https://example.com/pricing');
  assert.deepEqual(r.categories, [{ title: 'Crawlability', score: 82 }]);
  assert.deepEqual(r.topFixes, [
    { label: 'Add an FAQ block', why: 'Answer engines quote Q&A markup.' },
  ]);
});

test('a report round-trips through JSON and still verifies', () => {
  const r = emailReport(report);
  const sig = signReport(r);
  assert.ok(verifyReport(JSON.parse(JSON.stringify(r)), sig));
});

test('tampering with any emailed field breaks the signature', () => {
  const r = emailReport(report);
  const sig = signReport(r);
  assert.ok(!verifyReport({ ...r, url: 'https://evil.example' }, sig));
  assert.ok(!verifyReport({ ...r, grade: 'A' }, sig));
  assert.ok(!verifyReport({ ...r, overall: 100 }, sig));
  assert.ok(!verifyReport({ ...r, categories: [{ title: 'Crawlability', score: 1 }] }, sig));
  assert.ok(
    !verifyReport({ ...r, topFixes: [{ label: 'Call 555-0100', why: 'Urgent.' }] }, sig),
  );
});

test('a missing or malformed signature never verifies', () => {
  const r = emailReport(report);
  assert.ok(!verifyReport(r, ''));
  assert.ok(!verifyReport(r, undefined));
  assert.ok(!verifyReport(r, 'a'.repeat(64)));
});

test('no key means nothing verifies', () => {
  const r = emailReport(report);
  const sig = signReport(r);
  const saved = process.env.REPORT_SIGNING_SECRET;
  const savedSg = process.env.SENDGRID_API_KEY;
  delete process.env.REPORT_SIGNING_SECRET;
  delete process.env.SENDGRID_API_KEY;
  assert.equal(signReport(r), null);
  assert.ok(!verifyReport(r, sig));
  process.env.REPORT_SIGNING_SECRET = saved;
  if (savedSg !== undefined) process.env.SENDGRID_API_KEY = savedSg;
});
