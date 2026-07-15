import dns from 'node:dns/promises';
import { isIP } from 'node:net';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 3_000_000;
const MAX_REDIRECTS = 4;
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

const hostResolvesPrivate = async (hostname) => {
  if (isIP(hostname)) {
    return isPrivateIp(hostname);
  }
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local')) {
    return true;
  }
  try {
    const records = await dns.lookup(hostname, { all: true });
    return records.some((r) => isPrivateIp(r.address));
  } catch {
    return true; // unresolvable -> treat as unsafe
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
    if (await hostResolvesPrivate(current.hostname)) {
      throw new Error('BLOCKED_HOST');
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

export const readCapped = async (res) => {
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
    if (total > MAX_BYTES) {
      await reader.cancel();
      break;
    }
  }
  return Buffer.concat(chunks).toString('utf-8');
};

// llms.txt is a same-origin GET, validated by construction from finalUrl.
export const checkLlmsTxt = async (finalUrl) => {
  try {
    const origin = new URL(finalUrl).origin;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const lr = await fetch(`${origin}/llms.txt`, {
      signal: controller.signal,
      headers: { 'User-Agent': UA },
    });
    clearTimeout(timer);
    return (
      lr.ok && /text\/(plain|markdown)/i.test(lr.headers.get('content-type') ?? 'text/plain')
    );
  } catch {
    return false;
  }
};
