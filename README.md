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
Central's AI-features guidance, OpenAI's and Anthropic's crawler docs, Cloudflare's
Agent Readiness score, and Chrome Lighthouse's agentic-browsing scoring.
`llms.txt` is reported but scored as informational only (Google has said it
ignores it).

## Scoring

31 checks — 28 scored over 114 weighted points, plus 3 informational. `pass` earns
full weight, `warn` half, `fail` nothing; `info` checks are excluded from the
denominator entirely.

Three conditions are **blockers**: `noindex`, a robots.txt `Disallow` on the
analysed path for Googlebot, and every AI retrieval crawler being blocked. Any
one of them caps the score at 39 (an F) and replaces the headline, because a page
no engine can reach should not grade well on presentation. The uncapped number is
kept as `rawScore`.

Deliberate asymmetries, so the score stays defensible:

- **Retrieval crawlers are scored, training crawlers are not.** Blocking
  `OAI-SearchBot` or `Claude-SearchBot` costs citations, so it fails. Blocking
  `GPTBot` or `Google-Extended` is a licensing decision and is reported as info at
  weight 0. Note `Google-Extended` governs only Gemini training and grounding —
  blocking it does not remove a page from AI Overviews or AI Mode.
- **Emerging protocol files score zero.** `llms.txt`, MCP server cards, Agent
  Skills indexes and API catalogues are reported for awareness. Markdown content
  negotiation is the only emerging signal carrying weight, because it has a
  measured benefit (Cloudflare: up to 80% fewer tokens than HTML).
- **Pass-by-default checks stay light.** `crawlable` is only 3 points: nearly
  every site passes it, so heavy weight would just inflate every score. Its
  severity comes from the blocker cap instead.

## SSW rules

Every check links to a rule under ssw.com.au/rules/. Two were written to back
the new checks and are now live, under a new "Rules to Better AEO and GEO"
category:

- [allow-ai-answer-engines](https://www.ssw.com.au/rules/allow-ai-answer-engines/) — AI crawler access and Content Signals (SSW.Rules.Content#13167)
- [serve-markdown-to-ai-agents](https://www.ssw.com.au/rules/serve-markdown-to-ai-agents/) — markdown content negotiation (SSW.Rules.Content#13168)
- [The category](https://www.ssw.com.au/rules/rules-to-better-aeo-and-geo/) (SSW.Rules.Content#13169)

Every slug in the `SSW` map was audited against SSW.Rules.Content and resolves to
a live, non-archived rule. The `qa` check used to point at
`do-you-phrase-the-heading-as-a-question`, which is archived, so it now points at
`ai-optimization-geo-aeo`.
