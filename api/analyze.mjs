import { analyzeHtml } from './_lib/engine.mjs';
import { emailReport, signReport } from './_lib/sign.mjs';
import {
  negotiateMarkdown,
  normalizeUrl,
  probeOrigin,
  readCapped,
  safeFetch,
} from './_lib/fetchSafe.mjs';

// Emerging agent-protocol files. Presence is reported, never scored, so a plain
// HEAD-shaped probe for existence is all we need.
const WELL_KNOWN = {
  'MCP server card': '/.well-known/mcp/server-card.json',
  'Agent Skills index': '/.well-known/agent-skills/index.json',
  'API catalogue': '/.well-known/api-catalog',
};

// Plenty of sites answer any unknown path with a 200 HTML page, so a probe that
// came back as HTML means the file does not exist.
const isSoft404 = (probe) => !probe || /html/i.test(probe.contentType);

const json = (res, status, body) => {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed.' });
  }

  // Vercel parses JSON bodies; fall back to manual parse for safety.
  let url;
  try {
    const body =
      typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}');
    url = body.url;
  } catch {
    return json(res, 400, { error: 'Invalid request.' });
  }
  if (typeof url !== 'string' || !url.trim()) {
    return json(res, 400, { error: 'A URL is required.' });
  }
  const target = normalizeUrl(url.trim());
  if (!target) {
    return json(res, 400, { error: 'That does not look like a valid http(s) URL.' });
  }

  try {
    const { res: pageRes, finalUrl } = await safeFetch(target);
    const contentType = pageRes.headers.get('content-type') ?? '';
    if (!pageRes.ok) {
      return json(res, 422, { error: `The page returned HTTP ${pageRes.status}.` });
    }
    if (!/html/i.test(contentType)) {
      return json(res, 422, { error: 'That URL did not return an HTML page.' });
    }

    const html = await readCapped(pageRes);
    const headers = {};
    pageRes.headers.forEach((v, k) => {
      headers[k] = v;
    });
    // Every origin probe is independent, so they all go out at once: one extra
    // round trip on top of the page fetch rather than eight.
    const wellKnownPaths = Object.entries(WELL_KNOWN);
    const [robotsTxt, sitemapXml, llmsTxt, llmsFullTxt, markdown, ...wellKnownRes] =
      await Promise.all([
        probeOrigin(finalUrl, '/robots.txt'),
        probeOrigin(finalUrl, '/sitemap.xml'),
        probeOrigin(finalUrl, '/llms.txt'),
        probeOrigin(finalUrl, '/llms-full.txt'),
        negotiateMarkdown(finalUrl),
        ...wellKnownPaths.map(([, p]) => probeOrigin(finalUrl, p)),
      ]);

    const wellKnown = {};
    wellKnownPaths.forEach(([label], i) => {
      wellKnown[label] = !!wellKnownRes[i];
    });

    const report = analyzeHtml({
      url: target.toString(),
      finalUrl,
      headers,
      html,
      robotsTxt: isSoft404(robotsTxt) ? null : robotsTxt.text,
      sitemapXml: !isSoft404(sitemapXml) && /<(urlset|sitemapindex)\b/i.test(sitemapXml.text),
      llmsTxt: !isSoft404(llmsTxt),
      llmsFullTxt: !isSoft404(llmsFullTxt),
      markdown,
      wellKnown,
      fetchedAt: new Date().toISOString(),
    });
    // The emailable slice travels back signed, so /api/lead can tell a report we
    // produced from one someone made up.
    const emailable = emailReport(report);
    return json(res, 200, { ...report, emailReport: emailable, sig: signReport(emailable) });
  } catch (err) {
    const MESSAGES = {
      UNRESOLVABLE_HOST: 'We couldn’t find that domain. Check the spelling and try again.',
      BLOCKED_HOST: 'That looks like a private or internal address, so we can’t reach it.',
      TOO_MANY_REDIRECTS: 'That URL redirected too many times. Try the page it ends up on.',
      BAD_REDIRECT: 'That URL redirected somewhere we can’t follow. Try the final page instead.',
    };
    const msg =
      MESSAGES[err?.message] ??
      (err?.name === 'AbortError'
        ? 'That page took too long to respond. Try again, or try a different page.'
        : 'We couldn’t load that page. Check it’s public and try again.');
    return json(res, 422, { error: msg });
  }
}
