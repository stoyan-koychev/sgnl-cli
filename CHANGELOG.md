# Changelog

## 1.2.0

### Minor Changes

- [#4](https://github.com/stoyan-koychev/sgnl-cli/pull/4) [`7b1734c`](https://github.com/stoyan-koychev/sgnl-cli/commit/7b1734c8a8c6a91d55ec13572cec46d50bc65d9f) Thanks [@stoyan-koychev](https://github.com/stoyan-koychev)! - Add Playwright headless browser for JS rendering, mobile screenshots, improved content extraction with GFM table parity, srcset resolution, extraction options (--full-content, --include-tags, --exclude-tags), and bot detection mitigation

## 1.1.0

### Minor Changes

- [#2](https://github.com/stoyan-koychev/sgnl-cli/pull/2) [`fb278da`](https://github.com/stoyan-koychev/sgnl-cli/commit/fb278da2e6d8118f9f209b0c83303d4cbf59a417) Thanks [@stoyan-koychev](https://github.com/stoyan-koychev)! - Improve content extraction with expanded HTML cleanup (42+ non-content selectors), URL absolutization, skip-to-content link removal, and better whitespace handling

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-04-07

### Analysis Commands

- `sgnl analyze <url>` — full pipeline combining HTTP fetch, Python HTML analysis,
  PageSpeed Insights, Chrome UX Report, and optional GSC data. Supports `--follow`
  for multi-page crawling, `--stream` for incremental JSON, `--save` for Markdown
  reports, and `--device` for mobile/desktop emulation.
- `sgnl content <url>` — language-neutral content extraction returning cleaned
  markdown body, volume/structure/media/link stats, heading outline, and link/image
  inventories. Designed to pipe into an LLM for subjective analysis.
- `sgnl technical <url>` — technical SEO audit covering meta tags, canonical, robots
  directives, redirect chains, security headers, caching, resource hints, hreflang,
  URL structure, and indexability signals.
- `sgnl structure <url>` — DOM and page structure analysis including element
  distribution, semantic score, accessibility audit, script inventory with
  third-party categorization, and crawlability checks.
- `sgnl performance <url>` — Core Web Vitals, Lighthouse scores, lab metrics,
  field data (CrUX), resource summary, render-blocking resources, opportunities,
  and diagnostics. Supports `--strategy both` for dual mobile/desktop analysis.
- `sgnl schema <url>` — JSON-LD structured data validation with required/recommended
  field checks, format error detection, and rich results eligibility.
- `sgnl robots <url>` — robots.txt analysis with multi-agent verdicts, AI bot
  blocking summary, wildcard detection, sitemap discovery, and syntax validation.

### Explorer

- `sgnl explorer crawl <url>` — site-wide crawler producing a compressed link graph
  with pre-computed PageRank, community detection (content clusters), and optional
  GSC ranking data overlay. Supports Googlebot simulation, sitemap seeding,
  CSS-based link exclusion, and configurable depth/delay/max-pages.
- `sgnl explorer inspect` / `links` / `list-issues` / `top-pages` / `clusters` /
  `cluster` / `depth-map` / `external` / `unranked` — query commands for crawl data.

### Google Search Console

- `sgnl gsc login` / `logout` / `status` — OAuth2 authentication with
  auto-discovery of verified properties.
- `sgnl gsc pages` / `queries` / `url` / `inspect` / `sitemaps` — GSC data
  commands with period comparison, country/device filters, and CSV export.

### Setup & Configuration

- `sgnl init` — interactive setup wizard for API keys and output path.
- Configuration in `~/.sgnl/config.json` with env var overrides
  (`SGNL_PSI_KEY`, `SGNL_DEBUG`).
- Automatic Python dependency setup on install via postinstall script.

### Library API

- Programmatic exports: `buildReport`, `buildReportStream`, `resolveConfig`,
  `safeFetch`, `callPSI`, `mergeAnalysis`, `Explorer`, `buildCompactData`,
  `findLatestRun`, `loadRun`, and all associated types.

### AI Agent Skills

- `skills/sgnl/SKILL.md` — entry point with compact CLI reference and skill router.
- `ai-seo-audit` — 7-step AI-era SEO audit (keyword placement, AI citation
  readiness, search intent, topical coverage, AI-readiness structure, authority
  signals, AI query matching).
- `url-comparison` — compare two URLs across all dimensions with scored verdict.
- `seo-content-analyzer` — 5-step content quality pipeline (question generation,
  coverage analysis, AI extractability, EEAT evaluation, AI citation simulation).
- `sgnl-cli-guide` — comprehensive CLI operating guide for AI agents.

### Custom HTTP Headers

- `sgnl headers set/list/remove/clear` — manage persistent custom HTTP headers
  (global or per-domain) stored in `~/.sgnl/config.json`.
- `-H "Name: Value"` flag on `analyze`, `technical`, `content`, `structure`,
  `schema`, `robots`, and `explorer crawl` for one-off header overrides.
- Headers flow through all HTTP paths: `safeFetch`, Explorer crawler, and
  Python `robots_check.py`.
- Sensitive header values (Cookie, Authorization) are masked in `sgnl headers list`.
- Config file permissions set to `0600` on save for security.

### Infrastructure

- Switched package manager from npm to pnpm.
- 428+ tests across unit and integration suites.
- Python analysis layer (DOM X-ray, on-page SEO, content extraction, schema validation).
- All commands support `--output json`, `--save`, `--device`, and `--timeout` flags.
