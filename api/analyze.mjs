import { analyzeHtml } from './_lib/engine.mjs';
import {
  checkLlmsTxt,
  normalizeUrl,
  readCapped,
  safeFetch,
} from './_lib/fetchSafe.mjs';

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
    const llmsTxt = await checkLlmsTxt(finalUrl);

    const report = analyzeHtml({
      url: target.toString(),
      finalUrl,
      headers,
      html,
      llmsTxt,
      fetchedAt: new Date().toISOString(),
    });
    return json(res, 200, report);
  } catch (err) {
    const msg =
      err?.message === 'BLOCKED_HOST'
        ? 'That host is not allowed.'
        : err?.name === 'AbortError'
          ? 'The page took too long to respond.'
          : 'Could not reach that URL. Check it is public and try again.';
    return json(res, 422, { error: msg });
  }
}
