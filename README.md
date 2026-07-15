# AI Search Readiness Checker

A standalone, static lead-capture tool that scores any page for SEO and
answer-engine optimization (AEO/GEO), graded against Google's own guidance and
published research. Built to match the tina.io brand.

## Architecture

Deliberately not a framework app. It is a static frontend plus two small Vercel
serverless functions.

```
index.html            Static page (hero + form)
styles.css            Brand-matched CSS (tina.io tokens)
app.js                Vanilla JS: calls the API, renders the report
api/
  analyze.mjs         POST { url } -> fetches + scores the page (Node function)
  lead.mjs            POST { email, note } -> Mailchimp (env-gated)
  _lib/
    engine.mjs        Pure, dependency-free analyzer (the reusable core)
    fetchSafe.mjs     SSRF-safe fetch (DNS-resolves, blocks private IPs)
    engine.test.mjs   node:test self-check (no deps)
```

Why a serverless function and not pure static: a browser cannot fetch and
analyze an arbitrary third-party URL (CORS), and doing it safely requires
server-side SSRF protection. `analyze.mjs` is the minimum backend; everything
else is static.

## Develop

```bash
npm test            # run the analyzer self-check
vercel dev          # run the full stack locally (needs `npm i -g vercel`)
```

Without the Vercel CLI, the engine is still testable in isolation via `npm test`.

## Deploy

Its own Vercel project (suggested domain: `tools.tina.io`). Zero build step;
Vercel serves the static files and turns `api/*.mjs` into functions.

Optional env vars for lead capture (without them, the tool still works and the
gate still unlocks, it just doesn't store the lead):

- `MAILCHIMP_API_KEY` (format `key-usX`)
- `MAILCHIMP_AUDIENCE_ID`

## Evidence

Every check links its source and is tagged Official docs / Study / Vendor view /
Experimental. Key sources: the GEO paper (arXiv 2311.09735), Google Search
Central's AI-features guidance, and Chrome Lighthouse's agentic-browsing scoring.
`llms.txt` is reported but scored as informational only (Google has said it
ignores it).
