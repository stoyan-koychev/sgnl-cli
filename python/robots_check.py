#!/usr/bin/env python3
"""
robots_check.py — Robots.txt Fetch + Validation

Fetches {origin}/robots.txt for the given URL, parses per-user-agent Disallow/
Allow rules, applies Google's longest-match resolution (with *$ wildcards),
analyzes every Sitemap referenced (with one level of index expansion),
captures HTTP metadata, and runs a battery of validation checks.

Input (stdin): JSON
  {
    "url": "https://example.com/some/path",
    "meta_robots_blocked": false,
    "timeout_ms": 30000  // optional; falls back to 10000
  }

Output (stdout): JSON — see analyze_robots() for the full shape. Backward
compatible with earlier callers: `sitemap_analysis` (singular) remains
populated as an alias for the first element of `sitemap_analyses`.
"""

import sys
import json
import re
import time
from urllib.parse import urlparse, urljoin
from urllib.request import urlopen, Request, build_opener, HTTPRedirectHandler
from urllib.error import URLError, HTTPError

USER_AGENT = 'SGNL-SEO-Analyzer/1.0'
GOOGLE_SIZE_LIMIT = 500 * 1024  # 512000 bytes, per Google's spec

# User-agent list the multi-agent verdict is computed for.
AGENT_LIST = [
    '*',
    'googlebot',
    'bingbot',
    'gptbot',
    'ccbot',
    'anthropic-ai',
    'google-extended',
    'perplexitybot',
    'bytespider',
]

AI_BOTS = [
    'gptbot',
    'ccbot',
    'anthropic-ai',
    'google-extended',
    'perplexitybot',
    'bytespider',
]

# Non-standard but well-known directives. We track these silently — presence
# of them is NOT a syntax warning.
KNOWN_NONSTANDARD = {'host', 'clean-param', 'noindex', 'request-rate', 'visit-time'}

# Recognized standard directives used for misspelling detection.
STANDARD_DIRECTIVES = {'user-agent', 'disallow', 'allow', 'crawl-delay', 'sitemap'}


# ---------------------------------------------------------------------------
# HTTP fetch with metadata capture
# ---------------------------------------------------------------------------


class _RedirectTracker(HTTPRedirectHandler):
    """urllib redirect handler that records every intermediate Location."""

    def __init__(self):
        self.chain: list = []

    def http_error_301(self, req, fp, code, msg, headers):
        new_url = headers.get('location') or headers.get('Location')
        if new_url:
            self.chain.append(new_url)
        return super().http_error_301(req, fp, code, msg, headers)

    def http_error_302(self, req, fp, code, msg, headers):
        new_url = headers.get('location') or headers.get('Location')
        if new_url:
            self.chain.append(new_url)
        return super().http_error_302(req, fp, code, msg, headers)

    http_error_303 = http_error_302
    http_error_307 = http_error_302
    http_error_308 = http_error_301


def fetch_robots_txt(origin: str, timeout_s: float = 10.0, custom_headers: dict = None) -> dict:
    """
    Fetch {origin}/robots.txt. Returns a dict with HTTP metadata:
      { status_code, content, final_url, content_type, content_length,
        elapsed_ms, redirect_chain, error }
    status_code == 0 indicates an unreachable or transport error.
    """
    robots_url = f"{origin}/robots.txt"
    tracker = _RedirectTracker()
    opener = build_opener(tracker)
    req_headers = {'User-Agent': USER_AGENT}
    if custom_headers:
        req_headers.update(custom_headers)
    req = Request(robots_url, headers=req_headers)
    start = time.perf_counter()

    def _result(status_code, content='', final_url=robots_url, content_type=None,
                content_length=None, error=None):
        return {
            'robots_url': robots_url,
            'status_code': status_code,
            'content': content,
            'final_url': final_url,
            'content_type': content_type,
            'content_length': content_length,
            'elapsed_ms': int((time.perf_counter() - start) * 1000),
            'redirect_chain': list(tracker.chain),
            'error': error,
        }

    try:
        with opener.open(req, timeout=timeout_s) as resp:
            status_code = resp.status
            raw = resp.read()
            content = raw.decode('utf-8', errors='replace')
            ct = resp.headers.get('Content-Type')
            cl = resp.headers.get('Content-Length')
            try:
                cl_int = int(cl) if cl is not None else len(raw)
            except (ValueError, TypeError):
                cl_int = len(raw)
            return _result(
                status_code=status_code,
                content=content,
                final_url=resp.geturl() or robots_url,
                content_type=ct,
                content_length=cl_int,
            )
    except HTTPError as e:
        # HTTPError is still a response — we can read headers and body.
        try:
            raw = e.read() if e.fp else b''
            content = raw.decode('utf-8', errors='replace') if raw else ''
        except Exception:
            content = ''
        ct = None
        try:
            ct = e.headers.get('Content-Type') if e.headers else None
        except Exception:
            pass
        return _result(
            status_code=e.code,
            content=content,
            final_url=getattr(e, 'url', robots_url) or robots_url,
            content_type=ct,
            content_length=len(content) if content else None,
            error=f'HTTP {e.code}',
        )
    except URLError as e:
        return _result(status_code=0, error=f'URL error: {e.reason}')
    except Exception as e:
        return _result(status_code=0, error=str(e)[:200])


# ---------------------------------------------------------------------------
# Wildcard → regex + longest-match resolution
# ---------------------------------------------------------------------------


def _rule_to_regex(pattern: str) -> 're.Pattern':
    """
    Convert a robots.txt rule (with `*` wildcard and optional trailing `$`
    anchor) to a compiled regex anchored at the start of the path.
    Per Google's spec:
      - `*` matches any sequence of characters
      - `$` at the end anchors the end of the URL
      - All other regex specials are escaped literally
    """
    has_end_anchor = pattern.endswith('$')
    body = pattern[:-1] if has_end_anchor else pattern
    # Escape everything, then un-escape the wildcard `*`.
    escaped = re.escape(body).replace(r'\*', '.*')
    regex = '^' + escaped
    if has_end_anchor:
        regex += '$'
    return re.compile(regex)


def _rule_specificity(pattern: str) -> int:
    """
    Length used to pick the "longest match" per Google's spec.
    Wildcards count as 1 character; the $ end-anchor does not count.
    """
    body = pattern[:-1] if pattern.endswith('$') else pattern
    # Treat `*` as one character (Google's behaviour).
    return len(body)


def path_matches_rule(path: str, rule: str) -> bool:
    """Return True if `rule` matches the start of `path` (wildcards/anchors supported)."""
    if not rule:
        return False
    try:
        return _rule_to_regex(rule).match(path) is not None
    except re.error:
        return False


def is_path_disallowed(path: str, disallow_rules: list, allow_rules: list) -> bool:
    """
    Apply Google's longest-match Allow vs Disallow resolution.
    Returns True iff the matching Disallow rule is strictly longer than the
    matching Allow rule. Ties go to Allow (i.e. not disallowed).
    An empty Disallow value is a no-op (standard behaviour).
    """
    longest_allow = -1
    for rule in allow_rules:
        if rule and path_matches_rule(path, rule):
            longest_allow = max(longest_allow, _rule_specificity(rule))

    longest_disallow = -1
    for rule in disallow_rules:
        if rule == '':
            # "Disallow:" with empty value means "allow everything" — not a match.
            continue
        if path_matches_rule(path, rule):
            longest_disallow = max(longest_disallow, _rule_specificity(rule))

    if longest_disallow < 0:
        return False
    if longest_allow < 0:
        return True
    # Tie goes to Allow per Google's spec.
    return longest_disallow > longest_allow


# ---------------------------------------------------------------------------
# Parser — per-user-agent rules
# ---------------------------------------------------------------------------


def parse_robots_txt(content: str) -> dict:
    """
    Parse robots.txt into a per-user-agent dict plus top-level sitemaps and
    syntax warnings. Also merges rules for `*` into the top level for
    backward compatibility with earlier callers.

    Returns:
      {
        'per_agent_rules': { '<agent>': { disallow, allow, crawl_delay }, ... },
        'sitemaps': [...],
        'disallow_rules': [...],   # top-level alias for per_agent_rules['*']
        'allow_rules': [...],      # top-level alias for per_agent_rules['*']
        'crawl_delay': number|None,
        'syntax_warnings': [...],
      }
    """
    per_agent: dict = {}
    sitemaps: list = []
    syntax_warnings: list = []

    current_agents: list = []
    seen_rule_without_agent = False
    last_was_agent = False
    _ensure_default_agent_block = False  # placeholder

    for raw_line_no, raw_line in enumerate(content.splitlines(), start=1):
        line = raw_line
        # Strip UTF-8 BOM (tolerated, not warned)
        if line.startswith('\ufeff'):
            line = line.lstrip('\ufeff')
        # Strip inline comment
        if '#' in line:
            line = line[:line.index('#')]
        line = line.strip()

        if not line:
            # Blank lines do NOT end a group — real-world parsers (including
            # Google's) treat the group as continuing until a new User-agent
            # line. We only reset `last_was_agent` so that a User-agent after
            # a blank line starts a fresh group rather than extending the
            # previous consecutive-agent block.
            last_was_agent = False
            continue

        # Line without a colon is a syntax warning (unless it's already empty).
        if ':' not in line:
            syntax_warnings.append(f'line {raw_line_no}: missing colon in "{line[:60]}"')
            continue

        directive, _, value = line.partition(':')
        directive_lower = directive.strip().lower()
        value = value.strip()

        # Misspelled directives: plural forms, etc.
        misspellings = {
            'user-agents': 'user-agent',
            'disallows': 'disallow',
            'allows': 'allow',
            'crawl-delays': 'crawl-delay',
            'sitemaps': 'sitemap',
        }
        if directive_lower in misspellings:
            syntax_warnings.append(
                f'line {raw_line_no}: "{directive.strip()}" looks like a typo for '
                f'"{misspellings[directive_lower]}"'
            )
            directive_lower = misspellings[directive_lower]

        if directive_lower == 'user-agent':
            agent = value.lower()
            if not agent:
                syntax_warnings.append(f'line {raw_line_no}: empty user-agent')
                continue
            if last_was_agent:
                # Multiple consecutive User-agents form one group.
                current_agents.append(agent)
            else:
                current_agents = [agent]
            per_agent.setdefault(agent, {
                'disallow': [],
                'allow': [],
                'crawl_delay': None,
            })
            last_was_agent = True
            continue

        last_was_agent = False

        if directive_lower == 'sitemap':
            if value:
                sitemaps.append(value)
            continue

        if directive_lower in KNOWN_NONSTANDARD:
            # Silently track — not a warning.
            continue

        if directive_lower not in STANDARD_DIRECTIVES:
            syntax_warnings.append(
                f'line {raw_line_no}: unknown directive "{directive.strip()}"'
            )
            continue

        # Rule lines need a user-agent context.
        if not current_agents:
            if not seen_rule_without_agent:
                syntax_warnings.append(
                    f'line {raw_line_no}: rule "{directive.strip()}" appears before any User-agent'
                )
                seen_rule_without_agent = True
            continue

        for agent in current_agents:
            block = per_agent.setdefault(agent, {
                'disallow': [],
                'allow': [],
                'crawl_delay': None,
            })
            if directive_lower == 'disallow':
                block['disallow'].append(value)
            elif directive_lower == 'allow':
                if value:
                    block['allow'].append(value)
            elif directive_lower == 'crawl-delay':
                try:
                    block['crawl_delay'] = float(value)
                except ValueError:
                    syntax_warnings.append(
                        f'line {raw_line_no}: invalid crawl-delay "{value}"'
                    )

    star_block = per_agent.get('*', {'disallow': [], 'allow': [], 'crawl_delay': None})

    return {
        'per_agent_rules': per_agent,
        'sitemaps': sitemaps,
        # Backward-compatible top-level aliases (merged from `*`):
        'disallow_rules': [r for r in star_block['disallow'] if r],
        'allow_rules': list(star_block['allow']),
        'crawl_delay': star_block['crawl_delay'],
        'syntax_warnings': syntax_warnings,
    }


# ---------------------------------------------------------------------------
# Verdict resolution
# ---------------------------------------------------------------------------


def resolve_agent_block(per_agent: dict, agent: str) -> dict:
    """
    Per Google's spec: use the most-specific matching user-agent group (exact
    match, case-insensitive). If none matches, fall back to `*`. Returns the
    resolved {disallow, allow, crawl_delay} block.
    """
    agent_lower = agent.lower()
    if agent_lower in per_agent:
        return per_agent[agent_lower]
    return per_agent.get('*', {'disallow': [], 'allow': [], 'crawl_delay': None})


def compute_agent_verdicts(path: str, per_agent: dict) -> dict:
    """Return `{agent: 'allowed'|'disallowed'}` for each entry in AGENT_LIST."""
    out: dict = {}
    for agent in AGENT_LIST:
        block = resolve_agent_block(per_agent, agent)
        disallowed = is_path_disallowed(path, block.get('disallow', []), block.get('allow', []))
        out[agent] = 'disallowed' if disallowed else 'allowed'
    return out


def compute_ai_bot_summary(per_agent: dict) -> dict:
    """
    Count AI bots with ANY explicit disallow or allow block of their own
    (i.e. NOT just the inherited `*` rules). An agent with a declared block
    but zero rules still counts — presence of the block signals intent.
    """
    blocked_agents: list = []
    for bot in AI_BOTS:
        block = per_agent.get(bot.lower())
        if block and (block.get('disallow') or block.get('allow')):
            # Any disallow rule (including `/`) or any allow rule counts.
            if any(r != '' for r in block.get('disallow', [])) or block.get('allow'):
                blocked_agents.append(bot)
    return {
        'blocked_count': len(blocked_agents),
        'blocked_agents': blocked_agents,
        'total_checked': len(AI_BOTS),
    }


# ---------------------------------------------------------------------------
# Sitemap analysis
# ---------------------------------------------------------------------------


def _analyze_single_sitemap(sitemap_url: str, timeout_s: float,
                            expand_index: bool = True) -> dict:
    """Fetch and analyze one sitemap. Optionally expands one level of indexes."""
    try:
        req = Request(sitemap_url, headers={'User-Agent': USER_AGENT})
        with urlopen(req, timeout=timeout_s) as resp:
            content = resp.read().decode('utf-8', errors='replace')

        is_index = '<sitemapindex' in content
        url_count = content.count('<url>') if not is_index else content.count('<sitemap>')
        has_lastmod = '<lastmod>' in content

        result = {
            'url': sitemap_url,
            'url_count': url_count,
            'has_lastmod': has_lastmod,
            'is_index': is_index,
            'error': None,
        }

        if is_index and expand_index:
            # Expand up to 3 child sitemaps and sum their URL counts.
            child_urls = re.findall(r'<loc>\s*([^<\s]+)\s*</loc>', content)
            children_fetched = 0
            total_child_urls = 0
            for child in child_urls[:3]:
                try:
                    creq = Request(child, headers={'User-Agent': USER_AGENT})
                    with urlopen(creq, timeout=timeout_s) as cresp:
                        ccontent = cresp.read().decode('utf-8', errors='replace')
                    children_fetched += 1
                    total_child_urls += ccontent.count('<url>')
                except Exception:
                    continue
            result['children_fetched'] = children_fetched
            result['total_urls_across_children'] = total_child_urls

        return result
    except Exception as e:
        return {
            'url': sitemap_url,
            'url_count': 0,
            'has_lastmod': False,
            'is_index': False,
            'error': str(e)[:200],
        }


def _discover_sitemap_fallback(origin: str, timeout_s: float) -> list:
    """Probe {origin}/sitemap.xml and /sitemap_index.xml via HEAD."""
    found: list = []
    for candidate in (f'{origin}/sitemap.xml', f'{origin}/sitemap_index.xml'):
        try:
            req = Request(candidate, headers={'User-Agent': USER_AGENT}, method='HEAD')
            with urlopen(req, timeout=timeout_s) as resp:
                if 200 <= resp.status < 300:
                    found.append(candidate)
        except Exception:
            continue
    return found


# ---------------------------------------------------------------------------
# Main analysis
# ---------------------------------------------------------------------------


def _strip_www(host: str) -> str:
    return host[4:] if host.lower().startswith('www.') else host


def analyze_robots(url: str, meta_robots_blocked: bool = False,
                   timeout_ms: int = 10000, custom_headers: dict = None) -> dict:
    """Full robots.txt analysis for the given URL."""
    timeout_s = max(1.0, timeout_ms / 1000.0)
    # Per-request sub-timeouts keep sitemap analysis from eating the whole budget.
    sitemap_timeout_s = min(5.0, timeout_s)

    try:
        parsed = urlparse(url)
        origin = f"{parsed.scheme}://{parsed.netloc}"
        path = parsed.path or '/'

        http = fetch_robots_txt(origin, timeout_s=timeout_s, custom_headers=custom_headers)
        status_code = http['status_code']
        content = http['content']

        request_meta = {
            'robots_url': http['robots_url'],
            'final_url': http['final_url'],
            'status_code': status_code,
            'content_type': http['content_type'],
            'content_length': http['content_length'],
            'elapsed_ms': http['elapsed_ms'],
            'redirect_chain': http['redirect_chain'],
        }

        # Validation flags (populated whenever we have metadata).
        size_exceeds = (http['content_length'] or 0) > GOOGLE_SIZE_LIMIT
        content_type_text_plain = bool(
            http['content_type'] and http['content_type'].lower().startswith('text/plain')
        )
        cross_origin_redirect = False
        if http['final_url']:
            try:
                final_host = _strip_www(urlparse(http['final_url']).netloc)
                origin_host = _strip_www(parsed.netloc)
                cross_origin_redirect = bool(final_host) and final_host != origin_host
            except Exception:
                pass

        # --- Unreachable (transport failure) ---------------------------------
        if status_code == 0:
            return {
                'fetched': False,
                'status_code': 0,
                'error': http.get('error') or 'Could not fetch robots.txt',
                'path_disallowed': False,
                'crawl_delay': None,
                'sitemaps': [],
                'disallow_rules': [],
                'allow_rules': [],
                'has_wildcard_disallow': False,
                'conflict_with_meta': False,
                'issues': ['robots_txt_unreachable'],
                'request': request_meta,
                'final_url': http['final_url'],
                'content_type': http['content_type'],
                'content_length': http['content_length'],
                'elapsed_ms': http['elapsed_ms'],
                'redirect_chain': http['redirect_chain'],
                'per_agent_rules': {},
                'per_agent_verdict': {},
                'ai_bot_summary': {'blocked_count': 0, 'blocked_agents': [], 'total_checked': len(AI_BOTS)},
                'sitemap_analyses': [],
                'sitemap_analysis': None,
                'syntax_warnings': [],
                'size_exceeds_google_limit': False,
                'content_type_is_text_plain': False,
                'cross_origin_redirect': cross_origin_redirect,
            }

        # --- 404 — no robots.txt (treat as fully allowed) --------------------
        if status_code == 404:
            return {
                'fetched': True,
                'status_code': 404,
                'path_disallowed': False,
                'crawl_delay': None,
                'sitemaps': [],
                'disallow_rules': [],
                'allow_rules': [],
                'has_wildcard_disallow': False,
                'conflict_with_meta': False,
                'issues': ['no_robots_txt'],
                'request': request_meta,
                'final_url': http['final_url'],
                'content_type': http['content_type'],
                'content_length': http['content_length'],
                'elapsed_ms': http['elapsed_ms'],
                'redirect_chain': http['redirect_chain'],
                'per_agent_rules': {},
                'per_agent_verdict': {a: 'allowed' for a in AGENT_LIST},
                'ai_bot_summary': {'blocked_count': 0, 'blocked_agents': [], 'total_checked': len(AI_BOTS)},
                'sitemap_analyses': [],
                'sitemap_analysis': None,
                'syntax_warnings': [],
                'size_exceeds_google_limit': False,
                'content_type_is_text_plain': content_type_text_plain,
                'cross_origin_redirect': cross_origin_redirect,
            }

        # --- 4xx other than 404: Google treats as fully allowed --------------
        if 400 <= status_code < 500 and status_code != 404:
            return {
                'fetched': True,
                'status_code': status_code,
                'path_disallowed': False,
                'crawl_delay': None,
                'sitemaps': [],
                'disallow_rules': [],
                'allow_rules': [],
                'has_wildcard_disallow': False,
                'conflict_with_meta': False,
                'issues': ['robots_txt_4xx_treated_as_allowed'],
                'request': request_meta,
                'final_url': http['final_url'],
                'content_type': http['content_type'],
                'content_length': http['content_length'],
                'elapsed_ms': http['elapsed_ms'],
                'redirect_chain': http['redirect_chain'],
                'per_agent_rules': {},
                'per_agent_verdict': {a: 'allowed' for a in AGENT_LIST},
                'ai_bot_summary': {'blocked_count': 0, 'blocked_agents': [], 'total_checked': len(AI_BOTS)},
                'sitemap_analyses': [],
                'sitemap_analysis': None,
                'syntax_warnings': [],
                'size_exceeds_google_limit': False,
                'content_type_is_text_plain': content_type_text_plain,
                'cross_origin_redirect': cross_origin_redirect,
            }

        # --- 5xx: Google treats as fully disallowed --------------------------
        if 500 <= status_code < 600:
            return {
                'fetched': True,
                'status_code': status_code,
                'path_disallowed': True,
                'reason': 'server_error_treated_as_disallow',
                'crawl_delay': None,
                'sitemaps': [],
                'disallow_rules': [],
                'allow_rules': [],
                'has_wildcard_disallow': True,
                'conflict_with_meta': False,
                'issues': ['robots_txt_5xx_treated_as_disallowed'],
                'request': request_meta,
                'final_url': http['final_url'],
                'content_type': http['content_type'],
                'content_length': http['content_length'],
                'elapsed_ms': http['elapsed_ms'],
                'redirect_chain': http['redirect_chain'],
                'per_agent_rules': {},
                'per_agent_verdict': {a: 'disallowed' for a in AGENT_LIST},
                'ai_bot_summary': {'blocked_count': 0, 'blocked_agents': [], 'total_checked': len(AI_BOTS)},
                'sitemap_analyses': [],
                'sitemap_analysis': None,
                'syntax_warnings': [],
                'size_exceeds_google_limit': size_exceeds,
                'content_type_is_text_plain': content_type_text_plain,
                'cross_origin_redirect': cross_origin_redirect,
            }

        # --- 2xx / 3xx: parse normally ---------------------------------------
        parsed_rules = parse_robots_txt(content)
        per_agent = parsed_rules['per_agent_rules']
        disallow_rules = parsed_rules['disallow_rules']
        allow_rules = parsed_rules['allow_rules']
        crawl_delay = parsed_rules['crawl_delay']
        sitemaps = parsed_rules['sitemaps']
        syntax_warnings = parsed_rules['syntax_warnings']

        # Check if the `*` block has zero rules (informational, not a warning)
        has_star_rules_for_agent = bool(per_agent.get('*', {}).get('disallow')) or bool(
            per_agent.get('*', {}).get('allow')
        )

        # Verdict for this URL under `*` (backward-compatible `path_disallowed`).
        path_disallowed = is_path_disallowed(path, disallow_rules, allow_rules)
        has_wildcard_disallow = any(
            r == '/' or r == '*' for r in disallow_rules
        )

        # Multi-agent verdict
        per_agent_verdict = compute_agent_verdicts(path, per_agent)
        ai_bot_summary = compute_ai_bot_summary(per_agent)

        conflict_with_meta = path_disallowed and not meta_robots_blocked and status_code == 200

        # Sitemap discovery fallback
        discovered_via_fallback = False
        if not sitemaps:
            fallback = _discover_sitemap_fallback(origin, sitemap_timeout_s)
            if fallback:
                sitemaps = fallback
                discovered_via_fallback = True

        # Analyze ALL sitemaps (cap at 5)
        sitemap_analyses: list = []
        for sm in sitemaps[:5]:
            sa = _analyze_single_sitemap(sm, timeout_s=sitemap_timeout_s, expand_index=True)
            if discovered_via_fallback:
                sa['discovered_via_fallback'] = True
            sitemap_analyses.append(sa)

        # --- Assemble issues -------------------------------------------------
        issues: list = []
        if path_disallowed:
            issues.append('path_disallowed_by_robots_txt')
        if has_wildcard_disallow:
            issues.append('wildcard_disallow_found')
        if crawl_delay and crawl_delay > 10:
            issues.append('high_crawl_delay')
        if not sitemaps:
            issues.append('no_sitemap_in_robots_txt')
        if conflict_with_meta:
            issues.append('conflict_robots_txt_vs_meta_robots')
        if size_exceeds:
            issues.append('robots_txt_too_large')
        if http['content_type'] and not content_type_text_plain:
            issues.append('robots_txt_not_text_plain')
        if cross_origin_redirect:
            issues.append('robots_txt_cross_origin_redirect')
        if not has_star_rules_for_agent and '*' not in per_agent:
            issues.append('no_rules_for_user_agent_star')

        return {
            'fetched': True,
            'status_code': status_code,
            'path_disallowed': path_disallowed,
            'crawl_delay': crawl_delay,
            'sitemaps': sitemaps,
            'disallow_rules': disallow_rules[:20],
            'allow_rules': allow_rules[:20],
            'has_wildcard_disallow': has_wildcard_disallow,
            'conflict_with_meta': conflict_with_meta,
            'issues': issues,
            'request': request_meta,
            'final_url': http['final_url'],
            'content_type': http['content_type'],
            'content_length': http['content_length'],
            'elapsed_ms': http['elapsed_ms'],
            'redirect_chain': http['redirect_chain'],
            'per_agent_rules': per_agent,
            'per_agent_verdict': per_agent_verdict,
            'ai_bot_summary': ai_bot_summary,
            'sitemap_analyses': sitemap_analyses,
            # Backward-compat alias — first sitemap only.
            'sitemap_analysis': sitemap_analyses[0] if sitemap_analyses else None,
            'syntax_warnings': syntax_warnings,
            'size_exceeds_google_limit': size_exceeds,
            'content_type_is_text_plain': content_type_text_plain,
            'cross_origin_redirect': cross_origin_redirect,
        }

    except Exception as e:
        return {
            'fetched': False,
            'status_code': 0,
            'error': str(e)[:200],
            'path_disallowed': False,
            'crawl_delay': None,
            'sitemaps': [],
            'disallow_rules': [],
            'allow_rules': [],
            'has_wildcard_disallow': False,
            'conflict_with_meta': False,
            'issues': ['robots_check_error'],
        }


def main() -> None:
    try:
        input_data = json.load(sys.stdin)
        url = input_data.get('url', '')
        meta_robots_blocked = bool(input_data.get('meta_robots_blocked', False))
        timeout_ms = int(input_data.get('timeout_ms', 10000))
        custom_headers = input_data.get('headers') or None

        if not url:
            result = {
                'fetched': False,
                'error': 'No URL provided',
                'path_disallowed': False,
                'crawl_delay': None,
                'sitemaps': [],
                'disallow_rules': [],
                'allow_rules': [],
                'has_wildcard_disallow': False,
                'conflict_with_meta': False,
                'issues': [],
            }
        else:
            result = analyze_robots(url, meta_robots_blocked, timeout_ms, custom_headers)

        json.dump(result, sys.stdout, ensure_ascii=False, separators=(',', ':'))
        sys.stdout.write('\n')

    except json.JSONDecodeError as e:
        sys.stderr.write(f"Invalid JSON input: {e}\n")
        sys.exit(1)
    except Exception as e:
        sys.stderr.write(f"Fatal error: {e}\n")
        json.dump({'error': str(e), 'fetched': False}, sys.stdout)
        sys.exit(1)


if __name__ == '__main__':
    main()
