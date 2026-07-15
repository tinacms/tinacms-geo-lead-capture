import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeHtml } from './engine.mjs';

const base = (html, extra = {}) => ({
  url: 'https://example.com',
  finalUrl: 'https://example.com',
  headers: {},
  html,
  llmsTxt: false,
  fetchedAt: '2026-01-01T00:00:00.000Z',
  ...extra,
});

test('scores a rich, well-formed page highly', () => {
  const html = `<!doctype html><html lang="en"><head>
    <title>How to optimize for AI search: a complete guide</title>
    <meta name="description" content="A practical, evidence-based guide.">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="canonical" href="https://example.com/guide">
    <meta property="og:title" content="AI search guide">
    <script type="application/ld+json">{"@type":"Article","author":{"@type":"Person","name":"A"},"dateModified":"2026-01-01"}</script>
    </head><body>
    <h1>How to optimize for AI search</h1>
    <h2>What is answer engine optimization?</h2>
    <p>In 2024, roughly 40% of queries changed. See the <a href="https://arxiv.org/abs/2311.09735">study</a>
    and <a href="https://developers.google.com/search">Google</a> and <a href="https://semrush.com">Semrush</a>.</p>
    <blockquote>Optimizing for AI search is still SEO.</blockquote>
    <ul><li>${'word '.repeat(300)}</li></ul>
    <table><tr><td>data</td></tr></table>
    <img src="a.png" alt="a chart of results">
    <a href="/next">Read next</a>
    </body></html>`;
  const r = analyzeHtml(base(html));
  assert.ok(r.overall > 80, `expected >80, got ${r.overall}`);
  assert.ok(r.grade === 'A' || r.grade === 'B');
  assert.equal(r.categories.length, 5);
});

test('fails hard on a noindexed, bare page', () => {
  const html = `<html><head><meta name="robots" content="noindex, nosnippet">
    </head><body><p>hi</p></body></html>`;
  const r = analyzeHtml(base(html, { finalUrl: 'http://example.com' }));
  const indexable = r.categories
    .find((c) => c.id === 'eligibility')
    .checks.find((c) => c.id === 'indexable');
  assert.equal(indexable.status, 'fail');
  assert.ok(r.overall < 45);
  assert.equal(r.grade, 'F');
});

test('treats llms.txt as informational, never scored', () => {
  const html = '<html><head><title>x</title></head><body>hi</body></html>';
  const withLlms = analyzeHtml(base(html, { llmsTxt: true }));
  const without = analyzeHtml(base(html, { llmsTxt: false }));
  assert.equal(withLlms.overall, without.overall);
  const check = withLlms.categories
    .find((c) => c.id === 'agentic')
    .checks.find((c) => c.id === 'llmstxt');
  assert.equal(check.status, 'info');
  assert.equal(check.weight, 0);
});

test('reports up to three highest-weight non-passing fixes', () => {
  const html = '<html><head></head><body></body></html>';
  const r = analyzeHtml(base(html, { finalUrl: 'http://example.com' }));
  assert.ok(r.topFixes.length <= 3);
  assert.ok(r.topFixes.every((c) => c.status !== 'pass'));
});

test('strips HTML tags out of extracted title text (defense in depth)', () => {
  const html = '<html><head><title>Hi<img src=x onerror=alert(1)>there</title></head><body></body></html>';
  const r = analyzeHtml(base(html));
  const title = r.categories
    .find((c) => c.id === 'fundamentals')
    .checks.find((c) => c.id === 'title');
  // Tags removed here; the client also escapes on render as a second layer.
  assert.ok(!title.detail.includes('<img'));
  assert.ok(!title.detail.includes('onerror'));
});
