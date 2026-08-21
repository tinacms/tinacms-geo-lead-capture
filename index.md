# Is your site ready for AI search?

A free tool from [TinaCMS](https://tina.io) that scores any page for SEO and
answer-engine optimization (AEO/GEO).

Check yours at <https://tina.io/geo>.

## What it checks

Paste a URL and it grades the page across five areas:

- **AI eligibility and crawlability** — whether the page can be fetched, indexed
  and quoted at all. Reads `robots.txt`, the meta robots tag and the
  `X-Robots-Tag` header, and separates AI *retrieval* crawlers
  (`OAI-SearchBot`, `Claude-User`, `Claude-SearchBot`, `PerplexityBot`) from AI
  *training* crawlers (`GPTBot`, `ClaudeBot`, `Google-Extended`). Blocking the
  first group costs you citations; blocking the second is a licensing decision
  and is reported without affecting the score.
- **Search fundamentals** — title, meta description, headings, viewport, `lang`,
  alt text, Open Graph.
- **Structured data and entities** — schema.org JSON-LD, and whether an author
  or publishing organization is declared.
- **Answer-engine content signals** — citations, statistics, quotations,
  scannable formatting, question-style headings, freshness and depth. These come
  from a controlled study which found that adding citations, statistics and
  quotations lifted a source's visibility in AI answers by roughly 30 to 40%.
- **Agentic and AI-crawler readiness** — markdown content negotiation, Content
  Signals, `llms.txt`, and accessible names on interactive elements.

Every check states the exact fix, links its evidence, and points at the relevant
[SSW rule](https://www.ssw.com.au/rules/rules-to-better-aeo-and-geo/).

## Notes on scoring

Blocking conditions cap the score. A page carrying `noindex`, disallowed to
Googlebot, or blocking every AI retrieval crawler cannot be reached or cited, so
it cannot grade well on presentation alone.

Emerging protocol files (`llms.txt`, MCP server cards, API catalogues) are
reported for awareness and scored zero. Markdown content negotiation is the one
emerging signal that carries weight, because it has a measured benefit.

## Related rules

- [Do you let AI answer engines crawl your site?](https://www.ssw.com.au/rules/allow-ai-answer-engines/)
- [Do you serve Markdown to AI agents?](https://www.ssw.com.au/rules/serve-markdown-to-ai-agents/)
- [Do you optimize your content for AI answers?](https://www.ssw.com.au/rules/ai-optimization-geo-aeo/)
- [Technical - Do you use Robots.txt file effectively?](https://www.ssw.com.au/rules/use-robots-txt-effectively/)
