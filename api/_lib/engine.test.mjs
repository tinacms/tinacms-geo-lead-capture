import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeHtml, isAllowed, parseRobots } from './engine.mjs';

const checkOf = (report, category, id) =>
  report.categories.find((c) => c.id === category).checks.find((c) => c.id === id);

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

test('parseRobots groups rules by user-agent and reads non-group directives', () => {
  const r = parseRobots(`
    # comment
    User-agent: *
    User-agent: Bingbot
    Disallow: /private
    Allow: /private/public

    User-agent: GPTBot
    Disallow: /

    Sitemap: https://example.com/sitemap.xml
    Content-Signal: ai-train=no, search=yes
  `);
  assert.equal(r.groups.length, 2);
  assert.deepEqual(r.groups[0].agents, ['*', 'bingbot']);
  assert.deepEqual(r.sitemaps, ['https://example.com/sitemap.xml']);
  assert.equal(r.contentSignal, 'ai-train=no, search=yes');
});

test('isAllowed applies longest-match precedence with Allow winning ties', () => {
  const robots = parseRobots(
    'User-agent: *\nDisallow: /private\nAllow: /private/public\nDisallow: /x\nAllow: /x\n',
  );
  assert.equal(isAllowed(robots, 'Googlebot', '/private/thing'), false);
  assert.equal(isAllowed(robots, 'Googlebot', '/private/public/thing'), true);
  assert.equal(isAllowed(robots, 'Googlebot', '/elsewhere'), true);
  // Equal-length Allow and Disallow: Allow wins.
  assert.equal(isAllowed(robots, 'Googlebot', '/x'), true);
});

test('isAllowed honours wildcards, end anchors and per-agent groups', () => {
  const robots = parseRobots(
    'User-agent: *\nDisallow: /*.pdf$\n\nUser-agent: GPTBot\nDisallow: /\n',
  );
  assert.equal(isAllowed(robots, 'Googlebot', '/docs/a.pdf'), false);
  assert.equal(isAllowed(robots, 'Googlebot', '/docs/a.pdf?v=1'), true, '$ anchors the match');
  assert.equal(isAllowed(robots, 'Googlebot', '/docs/a.html'), true);
  // A specific group replaces the * group rather than adding to it.
  assert.equal(isAllowed(robots, 'GPTBot', '/anything'), false);
  assert.equal(isAllowed(robots, 'gptbot', '/anything'), false, 'agent match is case-insensitive');
  // No robots.txt at all means nothing is disallowed.
  assert.equal(isAllowed(null, 'Googlebot', '/anything'), true);
});

test('blocks on a robots.txt Disallow and caps the score regardless of page quality', () => {
  const html = `<!doctype html><html lang="en"><head><title>A perfectly good page title</title>
    <meta name="description" content="Good."><meta name="viewport" content="width=device-width">
    <link rel="canonical" href="https://example.com/"></head><body><h1>Good</h1><h2>Also good?</h2>
    <blockquote>q</blockquote><ul><li>a</li></ul><table><tr><td>1</td></tr></table></body></html>`;
  const open = analyzeHtml(base(html));
  const blocked = analyzeHtml(base(html, { robotsTxt: 'User-agent: *\nDisallow: /\n' }));

  assert.ok(blocked.blockers.length > 0);
  assert.ok(blocked.overall < 45, `expected a capped F, got ${blocked.overall}`);
  assert.equal(blocked.grade, 'F');
  assert.ok(blocked.rawScore > blocked.overall, 'raw score is kept for reference');
  assert.match(blocked.headline, /Nothing else counts/);
  assert.equal(checkOf(blocked, 'eligibility', 'crawlable').status, 'fail');
  // Blockers are deliberately low-weight, so without the blocker flag heavier
  // content checks would push the fixes that matter out of the top three.
  assert.equal(blocked.topFixes[0].blocker, true);
  assert.ok(blocked.topFixes.some((f) => f.id === 'crawlable'));
  // Same HTML, no robots.txt: not blocked, and scores on its merits.
  assert.equal(open.blockers.length, 0);
  assert.equal(checkOf(open, 'eligibility', 'crawlable').status, 'pass');
});

test('scores retrieval crawlers but only reports training crawlers', () => {
  const html = '<html><head><title>A reasonable page title here</title></head><body>hi</body></html>';
  const trainingBlocked = analyzeHtml(
    base(html, { robotsTxt: 'User-agent: GPTBot\nDisallow: /\n' }),
  );
  const retrievalBlocked = analyzeHtml(
    base(html, { robotsTxt: 'User-agent: OAI-SearchBot\nDisallow: /\n' }),
  );

  // Blocking training is a licensing choice: reported, never scored, never a blocker.
  assert.equal(checkOf(trainingBlocked, 'eligibility', 'aicrawlers').status, 'pass');
  assert.equal(checkOf(trainingBlocked, 'eligibility', 'aitraining').status, 'info');
  assert.match(checkOf(trainingBlocked, 'eligibility', 'aitraining').detail, /GPTBot/);
  assert.equal(trainingBlocked.blockers.length, 0);

  // Blocking one retrieval bot costs points but is not fatal on its own.
  assert.equal(checkOf(retrievalBlocked, 'eligibility', 'aicrawlers').status, 'fail');
  assert.equal(retrievalBlocked.blockers.length, 0);
  assert.ok(retrievalBlocked.overall < trainingBlocked.overall);
});

test('treats a blanket AI block as a blocker', () => {
  const html = '<html><head><title>A reasonable page title here</title></head><body>hi</body></html>';
  const r = analyzeHtml(
    base(html, {
      robotsTxt: [
        'User-agent: OAI-SearchBot',
        'User-agent: Claude-User',
        'User-agent: Claude-SearchBot',
        'User-agent: PerplexityBot',
        'User-agent: Bingbot',
        'Disallow: /',
      ].join('\n'),
    }),
  );
  assert.ok(r.blockers.some((b) => /every AI retrieval crawler/.test(b)));
  assert.equal(r.grade, 'F');
});

test('markdown negotiation is scored, agent protocol files are not', () => {
  const html = '<html><head><title>A reasonable page title here</title></head><body>hi</body></html>';
  const plain = analyzeHtml(base(html));
  const md = analyzeHtml(base(html, { markdown: 'negotiated' }));
  const withMcp = analyzeHtml(base(html, { wellKnown: { 'MCP server card': true } }));

  assert.equal(checkOf(plain, 'agentic', 'markdown').status, 'warn');
  assert.equal(checkOf(md, 'agentic', 'markdown').status, 'pass');
  assert.ok(md.overall > plain.overall, 'markdown support earns points');
  // Emerging protocol files are reported for awareness and must not move the score.
  assert.equal(withMcp.overall, plain.overall);
  assert.equal(checkOf(withMcp, 'agentic', 'agentprotocols').status, 'info');
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

// Unbounded `[\s\S]*?` tag-pair scans are quadratic on unclosed tags: each
// opening tag scans to the end of the document looking for a close that never
// comes. 3MB of these took 51s, overrunning the 30s function limit on a single
// request. The bounds in engine.mjs cap it; this fails if they are removed.
test('a page of unclosed tags does not blow up parsing time', () => {
  const frags = [
    '<a href="#">x',
    '<h1>x',
    '<script type="application/ld+json">x',
    '<script>x',
    '<style>x',
    '<!--x',
  ];
  for (const frag of frags) {
    const html = `<html><body>${frag.repeat(Math.ceil(1_000_000 / frag.length))}</body></html>`;
    const started = process.hrtime.bigint();
    analyzeHtml(base(html));
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    // ~180ms bounded, ~5700ms unbounded — a 10x margin either side, so a loaded
    // CI box won't flake it.
    assert.ok(ms < 2000, `1MB of "${frag}" took ${ms.toFixed(0)}ms; bounds likely removed`);
  }
});

// The flip side of the bound: it has to stay clear of real structured data.
// A block over 20KB is dropped by design — that is the price of the cap.
test('a large but realistic JSON-LD block still parses', () => {
  const bigLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: Array.from({ length: 80 }, (_, i) => ({
      '@type': 'Question',
      name: `Question ${i}?`,
      acceptedAnswer: { '@type': 'Answer', text: 'x'.repeat(100) },
    })),
  });
  assert.ok(bigLd.length > 15_000, 'fixture should be large enough to matter');
  assert.ok(bigLd.length < 20_000, 'fixture should sit inside the bound');
  const html = `<html><head><title>T</title><script type="application/ld+json">${bigLd}</script></head><body><h1>Heading</h1></body></html>`;
  const r = analyzeHtml(base(html));
  const jsonld = r.categories
    .find((c) => c.id === 'structured')
    .checks.find((c) => c.id === 'jsonld');
  assert.ok(jsonld.detail.includes('FAQPage'), `a ${bigLd.length}-byte block should still parse`);
});

test('script, style and comment contents stay out of the visible text', () => {
  const html = `<html><head><title>Real title</title>
    <script>const secretWord = "scriptleak scriptleak scriptleak";</script>
    <style>.a{content:"styleleak styleleak"}</style></head>
    <body><!-- commentleak commentleak --><h1>Real heading</h1>
    <p>${'genuine prose about the subject matter '.repeat(40)}</p></body></html>`;
  const r = analyzeHtml(base(html));
  const serialized = JSON.stringify(r);
  assert.ok(!serialized.includes('scriptleak'), 'script body leaked into analysis');
  assert.ok(!serialized.includes('styleleak'), 'style body leaked into analysis');
  assert.ok(!serialized.includes('commentleak'), 'comment body leaked into analysis');
  assert.ok(serialized.includes('Real heading') || serialized.includes('Real title'));
});
