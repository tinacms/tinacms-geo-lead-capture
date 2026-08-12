/**
 * Static SEO x AEO/GEO analyzer.
 *
 * Pure function: given a fetched HTML document + response headers, return a
 * scored, evidence-tagged report. No network, no DOM, no dependencies, so it
 * runs unchanged in a Vercel function, a Worker, or a test.
 *
 * HTML is parsed with targeted regex, not a real parser. That is fine for these
 * static signals; if the check set grows DOM-shaped, swap in a parser.
 */

// Evidence catalogue. Every claim the tool makes points back to one of these.
const E = {
  googleAi: {
    type: 'official',
    source: 'Google Search Central',
    url: 'https://developers.google.com/search/docs/appearance/ai-features',
  },
  googleAiOpt: {
    type: 'official',
    source: 'Google Search Central',
    url: 'https://developers.google.com/search/docs/fundamentals/ai-optimization-guide',
  },
  googleTitle: {
    type: 'official',
    source: 'Google Search Central',
    url: 'https://developers.google.com/search/docs/appearance/title-link',
  },
  googleStructured: {
    type: 'official',
    source: 'Google Search Central',
    url: 'https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data',
  },
  geo: {
    type: 'study',
    source: "GEO, Aggarwal et al. (KDD '24)",
    url: 'https://arxiv.org/abs/2311.09735',
  },
  lighthouse: {
    type: 'experimental',
    source: 'Chrome Lighthouse, agentic browsing',
    url: 'https://developer.chrome.com/docs/lighthouse/agentic-browsing/scoring',
  },
  semrush: {
    type: 'opinion',
    source: 'Semrush',
    url: 'https://www.semrush.com/blog/answer-engine-optimization/',
  },
};

// --- tiny HTML extraction helpers (regex, deliberately narrow) ---------------

const stripScripts = (html) =>
  html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

const decode = (s) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();

const textContent = (html) =>
  decode(
    stripScripts(html)
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' '),
  );

const getTitle = (html) => {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decode(m[1].replace(/<[^>]+>/g, ' ')) : '';
};

const metaContent = (html, key) => {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${key}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  if (!tag) {
    return '';
  }
  return decode(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? '');
};

const headings = (html) => {
  const out = [];
  const re = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push({ level: Number(m[1]), text: decode(m[2].replace(/<[^>]+>/g, ' ')) });
  }
  return out;
};

const jsonLdTypes = (html) => {
  const types = [];
  const re =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const collect = (node) => {
        if (!node || typeof node !== 'object') {
          return;
        }
        if (Array.isArray(node)) {
          node.forEach(collect);
          return;
        }
        if (node['@type']) {
          const t = node['@type'];
          for (const x of Array.isArray(t) ? t : [t]) {
            types.push(x);
          }
        }
        if (node['@graph']) {
          collect(node['@graph']);
        }
      };
      collect(JSON.parse(m[1].trim()));
    } catch {
      types.push('__invalid__');
    }
  }
  return types;
};

const registrableHost = (host) => {
  const parts = host.replace(/^www\./, '').split('.');
  return parts.slice(-2).join('.');
};

const externalDomains = (html, pageUrl) => {
  let base = '';
  try {
    base = registrableHost(new URL(pageUrl).hostname);
  } catch {
    base = '';
  }
  const domains = new Set();
  const re = /<a[^>]+href=["'](https?:\/\/[^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const h = registrableHost(new URL(m[1]).hostname);
      if (h && h !== base) {
        domains.add(h);
      }
    } catch {
      // ignore malformed hrefs
    }
  }
  return Array.from(domains);
};

// --- scoring ------------------------------------------------------------------

const GRADE = (n) =>
  n >= 90 ? 'A' : n >= 75 ? 'B' : n >= 60 ? 'C' : n >= 45 ? 'D' : 'F';

const earnedOf = (c) =>
  c.status === 'pass' ? c.weight : c.status === 'warn' ? c.weight * 0.5 : 0;

export function analyzeHtml(input) {
  const { html, headers, finalUrl, url } = input;
  const lowerHeaders = {};
  for (const [k, v] of Object.entries(headers)) {
    lowerHeaders[k.toLowerCase()] = v;
  }

  const robotsMeta = metaContent(html, 'robots').toLowerCase();
  const xRobots = (lowerHeaders['x-robots-tag'] ?? '').toLowerCase();
  const robots = `${robotsMeta} ${xRobots}`;
  const hs = headings(html);
  const h1s = hs.filter((h) => h.level === 1);
  const h2s = hs.filter((h) => h.level === 2);
  const body = textContent(html);
  const words = body ? body.split(/\s+/).length : 0;
  const isHttps = finalUrl.startsWith('https://');
  const allTypes = jsonLdTypes(html);
  const types = allTypes.filter((t) => t !== '__invalid__');
  const invalidJsonLd = allTypes.includes('__invalid__');
  const ext = externalDomains(html, finalUrl);
  const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
  const imgsWithAlt = imgs.filter((t) => /alt=["'][^"']+["']/i.test(t));
  const lists = (html.match(/<(ul|ol|table)\b/gi) ?? []).length;
  const blockquotes = (html.match(/<blockquote\b/gi) ?? []).length;
  // Percentages, currency, large formatted numbers, and decimals with a unit
  // word. Bare 4-digit years are deliberately excluded: copyright/footer years
  // (© 2024) are noise, not statistics, and used to hand out free credit.
  const statMatches =
    body.match(
      /\d+(\.\d+)?\s?%|\$\s?\d|\b\d{1,3}(,\d{3})+\b|\b\d+(\.\d+)?\s?(million|billion|trillion|thousand|k|x|percent)\b/gi,
    ) ?? [];
  const qaHeadings = hs.filter(
    (h) =>
      h.text.includes('?') ||
      /^(how|what|why|when|where|who|which|can|should|does|do|is|are)\b/i.test(
        h.text.trim(),
      ),
  );

  const categories = [];
  const add = (id, title, blurb, checks) => {
    const possible = checks
      .filter((c) => c.status !== 'info')
      .reduce((a, c) => a + c.weight, 0);
    const earned = checks.reduce((a, c) => a + earnedOf(c), 0);
    categories.push({
      id,
      title,
      blurb,
      checks,
      possible,
      earned,
      score: possible ? Math.round((earned / possible) * 100) : 100,
    });
  };

  // 1. AI eligibility & crawlability ------------------------------------------
  const noindex = /\bnoindex\b/.test(robots);
  const nosnippet = /\bnosnippet\b/.test(robots) || /max-snippet:\s*0/.test(robots);
  const canonical = /<link[^>]+rel=["']canonical["']/i.test(html);
  add(
    'eligibility',
    'AI eligibility & crawlability',
    'Before a page can be quoted in AI Overviews or AI Mode it has to be indexable and snippet-eligible. These are the highest-signal checks, and the only fatal ones.',
    [
      {
        id: 'indexable',
        label: 'Page is indexable (no noindex)',
        status: noindex ? 'fail' : 'pass',
        detail: noindex
          ? 'A noindex directive was found. Google excludes noindex pages from Search and from AI features entirely.'
          : 'No noindex directive in the meta robots tag or X-Robots-Tag header.',
        fix: 'Remove the noindex from the robots meta tag / X-Robots-Tag header on pages you want cited.',
        why: 'Google states AI features only draw from pages eligible to appear in Search with a snippet.',
        weight: 12,
        evidence: E.googleAi,
      },
      {
        id: 'snippet',
        label: 'Snippets are allowed',
        status: nosnippet ? 'fail' : 'pass',
        detail: nosnippet
          ? 'A nosnippet or max-snippet:0 directive was found, which blocks the text AI answers quote from.'
          : 'No nosnippet / max-snippet:0 restriction detected.',
        fix: 'Drop nosnippet and any max-snippet:0. Use a generous max-snippet if you must limit length.',
        why: 'AI Overviews reuse the same snippet text; blocking snippets removes the page from those answers.',
        weight: 6,
        evidence: E.googleAi,
      },
      {
        id: 'https',
        label: 'Served over HTTPS',
        status: isHttps ? 'pass' : 'fail',
        detail: isHttps
          ? 'The final URL is served over HTTPS.'
          : 'The page is served over plain HTTP.',
        fix: 'Serve the site over HTTPS and redirect HTTP to HTTPS.',
        why: 'HTTPS is a long-standing Google ranking signal and a baseline trust marker.',
        weight: 6,
        evidence: E.googleAi,
      },
      {
        id: 'canonical',
        label: 'Canonical URL declared',
        status: canonical ? 'pass' : 'warn',
        detail: canonical
          ? 'A rel="canonical" link is present.'
          : 'No canonical link tag found. Duplicate URLs can split signals.',
        fix: 'Add a self-referential <link rel="canonical"> to consolidate duplicate URLs.',
        why: 'Canonicals help Google pick one URL to index and cite instead of splitting authority.',
        weight: 4,
        evidence: E.googleStructured,
      },
    ],
  );

  // 2. Search fundamentals -----------------------------------------------------
  const title = getTitle(html);
  const desc = metaContent(html, 'description');
  const viewport = /name=["']viewport["']/i.test(html);
  const lang = /<html[^>]+lang=["'][^"']+["']/i.test(html);
  const og = !!metaContent(html, 'og:title') || !!metaContent(html, 'og:description');
  const altRatio = imgs.length ? imgsWithAlt.length / imgs.length : 1;
  add(
    'fundamentals',
    'Search fundamentals',
    'Google is blunt about this: optimizing for AI search is still SEO. Get the basics right and most of the AEO/GEO job is done.',
    [
      {
        id: 'title',
        label: 'Descriptive <title>',
        status: !title ? 'fail' : title.length < 15 || title.length > 65 ? 'warn' : 'pass',
        detail: title
          ? `Title is ${title.length} characters: "${title.slice(0, 70)}".`
          : 'No <title> element found.',
        fix: 'Write a unique, descriptive title of roughly 15 to 60 characters.',
        why: 'The title is a primary relevance and click signal, and often the link text AI answers show.',
        weight: 6,
        evidence: E.googleTitle,
      },
      {
        id: 'description',
        label: 'Meta description',
        status: desc ? 'pass' : 'warn',
        detail: desc
          ? `Meta description present (${desc.length} characters).`
          : 'No meta description. Google may synthesize one, but you lose control of it.',
        fix: 'Add a concise meta description that summarizes the page for both users and answer engines.',
        why: 'Descriptions feed snippets, which AI answers draw from.',
        weight: 4,
        evidence: E.googleTitle,
      },
      {
        id: 'h1',
        label: 'Single, clear <h1>',
        status: h1s.length === 1 ? 'pass' : h1s.length === 0 ? 'fail' : 'warn',
        detail:
          h1s.length === 1
            ? `One <h1>: "${h1s[0].text.slice(0, 60)}".`
            : `${h1s.length} <h1> elements found. Aim for exactly one.`,
        fix: 'Use exactly one <h1> that states what the page is about.',
        why: 'A clear top heading tells both crawlers and LLMs the page topic.',
        weight: 4,
        evidence: E.semrush,
      },
      {
        id: 'headings',
        label: 'Logical heading structure',
        status: h2s.length >= 1 ? 'pass' : 'warn',
        detail: `${hs.length} headings total, ${h2s.length} <h2> sections.`,
        fix: 'Break content into <h2>/<h3> sections so engines can extract self-contained passages.',
        why: 'Answer engines lift individual passages; clear sectioning makes a page more quotable.',
        weight: 3,
        evidence: E.semrush,
      },
      {
        id: 'viewport',
        label: 'Mobile viewport set',
        status: viewport ? 'pass' : 'fail',
        detail: viewport
          ? 'A viewport meta tag is present.'
          : 'No viewport meta tag; the page is likely not mobile-friendly.',
        fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
        why: 'Google indexes mobile-first; a missing viewport signals a poor mobile page.',
        weight: 3,
        evidence: E.googleAi,
      },
      {
        id: 'lang',
        label: 'Language declared',
        status: lang ? 'pass' : 'warn',
        detail: lang
          ? 'The <html> element declares a lang attribute.'
          : 'No lang attribute on <html>.',
        fix: 'Set a lang attribute, e.g. <html lang="en">.',
        why: 'Declaring language aids correct interpretation and accessibility.',
        weight: 2,
        evidence: E.googleAi,
      },
      {
        id: 'alt',
        label: 'Images have alt text',
        status:
          imgs.length === 0 ? 'pass' : altRatio >= 0.8 ? 'pass' : altRatio >= 0.5 ? 'warn' : 'fail',
        detail:
          imgs.length === 0
            ? 'No <img> elements to check.'
            : `${imgsWithAlt.length} of ${imgs.length} images have alt text.`,
        fix: 'Add descriptive alt text to meaningful images.',
        why: 'Alt text is content engines can read and a core accessibility requirement.',
        weight: 3,
        evidence: E.googleAi,
      },
      {
        id: 'og',
        label: 'Open Graph tags',
        status: og ? 'pass' : 'warn',
        detail: og
          ? 'Open Graph metadata is present.'
          : 'No Open Graph tags found; shared links may render poorly.',
        fix: 'Add og:title, og:description and og:image for rich sharing previews.',
        why: 'Social previews drive the third-party mentions that correlate with AI visibility.',
        weight: 2,
        evidence: E.semrush,
      },
    ],
  );

  // 3. Structured data & E-E-A-T ----------------------------------------------
  // Two distinct signals (previously one boolean, double-counted):
  //  - hasSchemaType: did the page pick a recognized, page-appropriate type?
  //  - hasAuthorEntity: is authorship/publisher declared (the E-E-A-T signal)?
  const hasSchemaType = types.some((t) =>
    /Article|NewsArticle|BlogPosting|Product|FAQPage|HowTo|Recipe|Event|Organization|LocalBusiness|WebSite|WebPage|BreadcrumbList|Review|Person|VideoObject|Course/i.test(
      t,
    ),
  );
  const hasAuthorEntity =
    types.some((t) => /Organization|Person|LocalBusiness/i.test(t)) ||
    /"author"\s*:/i.test(html);
  add(
    'structured',
    'Structured data & entities',
    'Google is explicit that no special AI schema is required and structured data is not a citation trigger. It still earns rich results and reinforces entities, so it is a "nice to have", scored lightly and honestly.',
    [
      {
        id: 'jsonld',
        label: 'Structured data present',
        status: invalidJsonLd ? 'fail' : types.length > 0 ? 'pass' : 'warn',
        detail: invalidJsonLd
          ? 'A JSON-LD block failed to parse. Broken markup is worse than none.'
          : types.length
            ? `JSON-LD found: ${Array.from(new Set(types)).slice(0, 6).join(', ')}.`
            : 'No JSON-LD structured data found. It is optional, not required.',
        fix: 'Add valid schema.org JSON-LD that matches the visible content. Do not invent AI-specific schema.',
        why: 'Google: structured data is not required for AI features and must match visible text, but it aids rich results.',
        weight: 5,
        evidence: E.googleAiOpt,
      },
      {
        id: 'schematypes',
        label: 'Relevant schema types',
        status: hasSchemaType ? 'pass' : 'warn',
        detail: hasSchemaType
          ? 'Recognized, page-appropriate schema types are declared.'
          : 'No recognized content type (Article, Product, FAQPage, Organization…) detected.',
        fix: 'Use the schema type that fits the page (Article, Product, FAQPage, Organization).',
        why: 'Matching types unlock the right rich results and clarify what the page is.',
        weight: 3,
        evidence: E.googleStructured,
      },
      {
        id: 'entity',
        label: 'Author / organization identified',
        status: hasAuthorEntity ? 'pass' : 'warn',
        detail: hasAuthorEntity
          ? 'An author or publishing organization is declared in markup.'
          : 'No author or organization entity in markup.',
        fix: 'Declare the author (Person) and publisher (Organization) to support E-E-A-T.',
        why: 'Clear authorship supports experience, expertise, authority and trust signals.',
        weight: 3,
        evidence: E.googleAiOpt,
      },
    ],
  );

  // 4. Answer-engine content signals (the study-backed layer) ------------------
  const fresh =
    /dateModified/i.test(html) || !!metaContent(html, 'article:modified_time');
  add(
    'content',
    'Answer-engine content signals',
    'These are the moves a controlled study actually measured. In the GEO benchmark, adding citations, statistics and quotations lifted source visibility in AI answers by 30 to 40%, and keyword stuffing did nothing.',
    [
      {
        id: 'citations',
        label: 'Cites external sources',
        status: ext.length >= 3 ? 'pass' : ext.length >= 1 ? 'warn' : 'fail',
        detail: `${ext.length} distinct external domains linked${
          ext.length ? `: ${ext.slice(0, 4).join(', ')}` : ''
        }.`,
        fix: 'Link out to authoritative primary sources where you make factual claims.',
        why: 'Cite Sources was a top method in the GEO study, improving visibility ~28% (and up to +115% for lower-ranked pages).',
        weight: 6,
        evidence: E.geo,
      },
      {
        id: 'statistics',
        label: 'Includes statistics',
        status: statMatches.length >= 3 ? 'pass' : statMatches.length >= 1 ? 'warn' : 'fail',
        detail: `${statMatches.length} numeric/statistical mentions detected.`,
        fix: 'Back claims with concrete figures, percentages and dated data points.',
        why: 'Statistics Addition improved position-adjusted visibility ~31% in the GEO benchmark.',
        weight: 5,
        evidence: E.geo,
      },
      {
        id: 'quotations',
        label: 'Uses quotations',
        status: blockquotes >= 1 ? 'pass' : 'warn',
        detail: blockquotes
          ? `${blockquotes} blockquote element(s) found.`
          : 'No blockquotes detected.',
        fix: 'Add relevant expert or source quotations where they strengthen a point.',
        why: 'Quotation Addition was the single best method in the GEO study (+41% position-adjusted word count).',
        weight: 4,
        evidence: E.geo,
      },
      {
        id: 'scannable',
        label: 'Scannable formatting',
        status: lists >= 2 ? 'pass' : lists >= 1 ? 'warn' : 'fail',
        detail: `${lists} list/table element(s) found.`,
        fix: 'Use lists and tables to make key facts easy to extract.',
        why: 'Scannable structure makes passages easier for engines to lift into an answer.',
        weight: 3,
        evidence: E.semrush,
      },
      {
        id: 'qa',
        label: 'Question-style headings',
        status: qaHeadings.length >= 1 ? 'pass' : 'warn',
        detail: `${qaHeadings.length} heading(s) phrased as questions.`,
        fix: 'Phrase some headings as the questions users actually ask, then answer them directly below.',
        why: 'Question/answer phrasing maps a page onto real answer-engine queries.',
        weight: 3,
        evidence: E.semrush,
      },
      {
        id: 'freshness',
        label: 'Freshness signal',
        status: fresh ? 'pass' : 'warn',
        detail: fresh
          ? 'A modified/updated date signal is present.'
          : 'No machine-readable updated date found.',
        fix: 'Expose a dateModified in schema or article:modified_time, and keep content current.',
        why: 'Recency is a plausible relevance signal for time-sensitive answers.',
        weight: 3,
        evidence: E.semrush,
      },
      {
        id: 'depth',
        label: 'Content depth',
        status: words >= 600 ? 'pass' : words >= 300 ? 'warn' : 'fail',
        detail: `~${words} words of visible text.`,
        fix: 'Cover the topic thoroughly enough to answer the question completely.',
        why: 'Thin pages give engines little to quote; depth (not padding) helps.',
        weight: 3,
        evidence: E.semrush,
      },
    ],
  );

  // 5. Agentic web (emerging, mostly informational) ---------------------------
  const interactive = html.match(/<(a|button)\b[^>]*>[\s\S]*?<\/\1>/gi) ?? [];
  const unnamed = interactive.filter((el) => {
    const inner = decode(el.replace(/<[^>]+>/g, ' '));
    const hasName =
      inner.length > 0 || /aria-label=["'][^"']+["']|title=["'][^"']+["']/i.test(el);
    return !hasName;
  });
  add(
    'agentic',
    'Agentic web readiness',
    'Standards for AI agents browsing your site are still emerging. Lighthouse reports these as pass/fail, not a weighted score, so we treat them the same way.',
    [
      {
        id: 'labels',
        label: 'Interactive elements are labelled',
        status: interactive.length === 0 ? 'pass' : unnamed.length === 0 ? 'pass' : 'warn',
        detail:
          interactive.length === 0
            ? 'No links or buttons to check.'
            : `${unnamed.length} of ${interactive.length} links/buttons have no accessible name.`,
        fix: 'Give every link and button visible text or an aria-label so agents can act on them.',
        why: "Lighthouse's agentic checks flag unnamed controls; agents cannot reliably use what they cannot name.",
        weight: 4,
        evidence: E.lighthouse,
      },
      {
        id: 'llmstxt',
        label: 'llms.txt file',
        status: 'info',
        detail: input.llmsTxt
          ? 'An /llms.txt file was found.'
          : 'No /llms.txt file (this is fine).',
        fix: 'Optional. You can add one, but do not expect ranking gains from it.',
        why: 'Informational only: Google has said it ignores llms.txt, and no major engine confirms using it. Lighthouse merely reports its presence.',
        weight: 0,
        evidence: E.lighthouse,
      },
    ],
  );

  // SSW rule mapping per check. Slugs are real rules under ssw.com.au/rules/:
  // 17 point at existing rules, and 5 (lang, entity, citations, statistics,
  // quotations) at rules created to back this tool. Verified against the
  // SSW.Rules.Content repo.
  const SSW = {
    indexable: ['Do you make sure important pages are indexable?', 'page-indexed-by-google'],
    snippet: ['Do you allow search engines to show snippets?', 'page-indexed-by-google'],
    https: ['Do you use HTTPS everywhere?', 'do-you-provide-security-to-your-website-visitors'],
    canonical: ['Do you use canonical URLs?', 'seo-canonical-tags'],
    title: ['Do you have meaningful page titles?', 'make-title-h1-and-h2-tags-descriptive'],
    description: ['Do you write good meta descriptions?', 'html-meta-tags'],
    h1: ['Do you use a single H1 per page?', 'use-heading-tags-h1-h2-h3'],
    headings: ['Do you use semantic heading structure?', 'use-heading-tags-h1-h2-h3'],
    viewport: ['Is your website mobile-friendly?', 'responsive-design'],
    lang: ['Do you set the HTML lang attribute?', 'html-lang-attribute'],
    alt: ['Do you add alt text to images?', 'add-attributes-to-picture-links'],
    og: ['Do you add Open Graph tags?', 'use-open-graph'],
    jsonld: ['Do you use Schema.org structured data?', 'structured-data'],
    schematypes: ['Do you choose the right Schema.org types?', 'structured-data'],
    entity: ['Do you show authorship and E-E-A-T signals?', 'author-e-e-a-t'],
    citations: ['Do you cite authoritative sources?', 'cite-your-sources'],
    statistics: ['Do you back claims with statistics?', 'back-claims-with-data'],
    quotations: ['Do you include relevant quotations?', 'use-quotations'],
    scannable: ['Do you make content scannable?', 'web-users-dont-read'],
    qa: ['Do you use question-based headings?', 'do-you-phrase-the-heading-as-a-question'],
    freshness: ['Do you show when content was last updated?', 'query-deserves-freshness'],
    depth: ['Do you write comprehensive content?', 'optimise-content-for-topical-authority'],
    labels: ['Do you make interactive elements accessible?', 'wcag-compliance'],
    llmstxt: ['Do you understand llms.txt?', 'make-your-website-llm-friendly'],
  };
  for (const c of categories) {
    for (const ch of c.checks) {
      const s = SSW[ch.id];
      if (s) {
        ch.ssw = { title: s[0], url: `https://www.ssw.com.au/rules/${s[1]}/` };
      }
    }
  }

  const totalEarned = categories.reduce((a, c) => a + c.earned, 0);
  const totalPossible = categories.reduce((a, c) => a + c.possible, 0);
  const overall = totalPossible ? Math.round((totalEarned / totalPossible) * 100) : 0;

  const allScored = categories.flatMap((c) => c.checks).filter((c) => c.status !== 'info');
  const passCount = allScored.filter((c) => c.status === 'pass').length;

  const topFixes = allScored
    .filter((c) => c.status !== 'pass')
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);

  const grade = GRADE(overall);
  const headline =
    overall >= 75
      ? 'Strong footing for AI search. A few targeted fixes will push it further.'
      : overall >= 50
        ? 'A decent base with real gaps. The fixes below are where the wins are.'
        : 'Significant gaps are holding this page back from AI answers and search.';

  return {
    url,
    finalUrl,
    fetchedAt: input.fetchedAt,
    overall,
    grade,
    headline,
    categories,
    topFixes,
    passCount,
    totalScored: allScored.length,
  };
}
