import dns from 'node:dns/promises';
import { isIP } from 'node:net';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 3_000_000;
const MAX_REDIRECTS = 4;
const PROBE_TIMEOUT_MS = 3_000;
const PROBE_MAX_BYTES = 200_000;
const UA = 'TinaAiReadinessBot/1.0 (+https://tina.io/ai-search-readiness)';

// Reject loopback, private, link-local (incl. cloud metadata 169.254.169.254)
// and unique-local IPv6. This is the SSRF trust boundary, so it is not lazy.
const isPrivateIp = (ip) => {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v = ip.toLowerCase();
  return (
    v === '::1' ||
    v === '::' ||
    v.startsWith('fe80') ||
    v.startsWith('fc') ||
    v.startsWith('fd') ||
    v.startsWith('::ffff:127.') ||
    v.startsWith('::ffff:10.') ||
    v.startsWith('::ffff:192.168.')
  );
};

// 'ok' | 'private' | 'unresolvable'. Both non-ok results block the fetch; they
// are distinguished only so the user gets an accurate message, because a typo'd
// domain and a deliberately blocked one are very different mistakes.
const hostStatus = async (hostname) => {
  if (isIP(hostname)) {
    return isPrivateIp(hostname) ? 'private' : 'ok';
  }
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local')) {
    return 'private';
  }
  try {
    const records = await dns.lookup(hostname, { all: true });
    return records.some((r) => isPrivateIp(r.address)) ? 'private' : 'ok';
  } catch {
    return 'unresolvable';
  }
};

export const normalizeUrl = (raw) => {
  try {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return null;
    }
    return u;
  } catch {
    return null;
  }
};

// Manual redirect following so every hop is re-validated against private IPs.
export const safeFetch = async (start) => {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const status = await hostStatus(current.hostname);
    if (status !== 'ok') {
      throw new Error(status === 'private' ? 'BLOCKED_HOST' : 'UNRESOLVABLE_HOST');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(current.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = normalizeUrl(new URL(res.headers.get('location'), current).toString());
      if (!next) {
        throw new Error('BAD_REDIRECT');
      }
      current = next;
      continue;
    }
    return { res, finalUrl: current.toString() };
  }
  throw new Error('TOO_MANY_REDIRECTS');
};

export const readCapped = async (res, cap = MAX_BYTES) => {
  const reader = res.body?.getReader();
  if (!reader) {
    return await res.text();
  }
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.length;
    chunks.push(value);
    if (total > cap) {
      await reader.cancel();
      break;
    }
  }
  return Buffer.concat(chunks).toString('utf-8');
};

// Same-origin GET of a well-known path. The origin comes from an already
// validated finalUrl, so there is nothing new to check. Returns null for
// anything that is not a usable 2xx body, because every caller treats a failed
// probe and a missing file the same way.
export const probeOrigin = async (finalUrl, path, accept = '*/*') => {
  try {
    const origin = new URL(finalUrl).origin;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(`${origin}${path}`, {
        signal: controller.signal,
        headers: { 'User-Agent': UA, Accept: accept },
      });
      if (!res.ok) {
        return null;
      }
      return {
        contentType: res.headers.get('content-type') ?? '',
        text: await readCapped(res, PROBE_MAX_BYTES),
      };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
};

// The .md sibling convention. "/" has no stem to suffix, so it maps to
// /index.md rather than producing "https://example.com.md".
const mdVariantUrl = (finalUrl) => {
  const u = new URL(finalUrl);
  u.search = '';
  u.hash = '';
  const stem = u.pathname.replace(/\/+$/, '');
  u.pathname = stem ? `${stem}.md` : '/index.md';
  return u.toString();
};

// Does this origin serve a token-cheap markdown variant? Two shots: the
// Accept header, then the .md sibling. Redirects are not followed — finalUrl
// was validated hop by hop, a fresh redirect target would not be.
export const negotiateMarkdown = async (finalUrl) => {
  const isMarkdown = (ct) => /text\/(markdown|x-markdown)/i.test(ct);
  const get = async (target) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      return await fetch(target, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': UA, Accept: 'text/markdown' },
      });
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const negotiated = await get(finalUrl);
    if (negotiated.ok && isMarkdown(negotiated.headers.get('content-type') ?? '')) {
      return 'negotiated';
    }
  } catch {
    // fall through to the .md sibling
  }
  try {
    const sibling = await get(mdVariantUrl(finalUrl));
    if (sibling.ok && isMarkdown(sibling.headers.get('content-type') ?? '')) {
      return 'suffix';
    }
  } catch {
    // no markdown variant
  }
  return null;
};
