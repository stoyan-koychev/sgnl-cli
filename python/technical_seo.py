#!/usr/bin/env python3
"""
technical_seo.py — Technical SEO Analysis

Analyzes raw HTML + response headers for:
- Meta tags (title, description, robots)
- Canonical validation
- Open Graph tags
- JSON-LD schema
- Indexability signals
- Link analysis
- HTTP/HTTPS enforcement
"""

import sys
import json
import re
from typing import Dict, Any, Optional, List, Tuple
from urllib.parse import urlparse, parse_qs, urljoin
from collections import defaultdict

try:
    from bs4 import BeautifulSoup
except ImportError:
    sys.stderr.write("Error: BeautifulSoup4 required. Install with: pip install beautifulsoup4\n")
    sys.exit(1)


def _analyze_url_structure(url: str) -> Dict[str, Any]:
    """Analyze URL structure for SEO best practices."""
    issues: List[str] = []
    try:
        parsed = urlparse(url)
        path = parsed.path or '/'
        full_url_len = len(url)

        has_trailing_slash = path.endswith('/') and path != '/'
        has_uppercase = path != path.lower()
        has_special_chars = bool(re.search(r'[^a-zA-Z0-9/_.-]', path))
        has_double_slashes = '//' in path
        # Check if path segments contain meaningful words (not just IDs/hashes)
        segments = [s for s in path.split('/') if s]
        keyword_segments = [s for s in segments if re.match(r'^[a-z][a-z-]{2,}$', s)]

        if full_url_len > 75:
            issues.append(f'URL is long ({full_url_len} chars, recommended: <75)')
        if has_uppercase:
            issues.append('URL contains uppercase letters')
        if has_special_chars:
            issues.append('URL contains special characters')
        if has_double_slashes:
            issues.append('URL contains double slashes in path')

        return {
            'length': full_url_len,
            'path': path,
            'has_trailing_slash': has_trailing_slash,
            'has_uppercase': has_uppercase,
            'has_special_chars': has_special_chars,
            'has_double_slashes': has_double_slashes,
            'keyword_segments': len(keyword_segments),
            'total_segments': len(segments),
            'issues': issues,
        }
    except Exception:
        return {'length': len(url), 'path': '', 'issues': []}


def _analyze_caching(headers: Dict[str, str]) -> Dict[str, Any]:
    """Analyze caching headers."""
    cc = headers.get('cache-control', headers.get('Cache-Control', ''))
    etag = headers.get('etag', headers.get('ETag', ''))
    last_mod = headers.get('last-modified', headers.get('Last-Modified', ''))

    has_cc = bool(cc)
    has_etag = bool(etag)
    has_last_mod = bool(last_mod)

    max_age = None
    if has_cc:
        m = re.search(r'max-age=(\d+)', cc, re.IGNORECASE)
        if m:
            max_age = int(m.group(1))

    is_no_store = 'no-store' in cc.lower() if cc else False
    is_cacheable = has_cc and not is_no_store

    issues: List[str] = []
    if not has_cc:
        issues.append('Missing Cache-Control header')
    elif is_no_store:
        issues.append('Cache-Control: no-store — page is not cached')
    elif max_age is not None and max_age < 300:
        issues.append(f'Very short cache TTL ({max_age}s)')

    return {
        'cache_control': cc or None,
        'has_cache_control': has_cc,
        'has_etag': has_etag,
        'has_last_modified': has_last_mod,
        'max_age_seconds': max_age,
        'is_cacheable': is_cacheable,
        'issues': issues,
    }


def _analyze_resource_hints(soup: BeautifulSoup, base_url: Optional[str] = None) -> Dict[str, Any]:
    """Analyze resource hints: preload, prefetch, dns-prefetch, preconnect."""
    preload = []
    prefetch = []
    dns_prefetch = []
    preconnect = []

    for link in soup.find_all('link', rel=True):
        rel = ' '.join(link.get('rel', []))
        href = link.get('href', '')
        # Fall back to imagesrcset for preloaded images without href
        if not href:
            srcset = link.get('imagesrcset', '')
            if srcset:
                # Pick the first URL from the srcset
                href = srcset.split(',')[0].strip().split()[0]
        # Resolve relative URLs to absolute
        if href and base_url:
            href = urljoin(base_url, href)

        if 'preload' in rel:
            if not href:
                continue  # Skip preloads with no resolvable URL
            preload.append({'href': href, 'as': link.get('as', '')})
        elif 'prefetch' in rel:
            prefetch.append(href)
        elif 'dns-prefetch' in rel:
            try:
                domain = urlparse(href).netloc or href.strip('/')
            except Exception:
                domain = href
            dns_prefetch.append(domain)
        elif 'preconnect' in rel:
            try:
                domain = urlparse(href).netloc or href.strip('/')
            except Exception:
                domain = href
            preconnect.append(domain)

    return {
        'preload': preload,
        'prefetch': prefetch,
        'dns_prefetch': dns_prefetch,
        'preconnect': preconnect,
        'preload_count': len(preload),
        'dns_prefetch_count': len(dns_prefetch),
        'preconnect_count': len(preconnect),
    }


def analyze_technical_seo(html: str, headers: Optional[Dict[str, str]] = None, url: Optional[str] = None) -> Dict[str, Any]:
    """Analyze HTML for technical SEO factors."""
    try:
        soup = BeautifulSoup(html, 'html.parser')
        headers = headers or {}

        # Meta tag analysis
        meta_analysis = _analyze_meta_tags(soup)

        # Canonical validation
        canonical = _analyze_canonical(soup, url)

        # Open Graph + Twitter card tags
        open_graph = _analyze_open_graph(soup)

        # Indexability signals
        indexability = _analyze_indexability(soup, headers)

        # Link analysis
        links = _analyze_links(soup)

        # Security headers
        security_headers = _analyze_security_headers(headers)

        # Hreflang / internationalisation
        hreflang = _analyze_hreflang(soup)

        # Pagination + AMP
        pagination_amp = _analyze_pagination_amp(soup)

        # Caching headers
        caching = _analyze_caching(headers)

        # Resource hints
        resource_hints = _analyze_resource_hints(soup, url)

        result: Dict[str, Any] = {
            "meta": meta_analysis,
            "canonical": canonical,
            "open_graph": open_graph,
            "indexability": indexability,
            "links": links,
            "security_headers": security_headers,
            "hreflang": hreflang,
            "pagination_amp": pagination_amp,
            "caching": caching,
            "resource_hints": resource_hints,
        }

        # URL structure analysis (if URL provided)
        if url:
            result["url_structure"] = _analyze_url_structure(url)

        return result
    except Exception as e:
        sys.stderr.write(f"Error analyzing technical SEO: {e}\n")
        return {}


def _analyze_meta_tags(soup: BeautifulSoup) -> Dict[str, Any]:
    """Extract and validate meta tags."""
    result = {}
    
    # Title
    title_tag = soup.find('title')
    title_content = title_tag.string if title_tag else None
    result['title'] = {
        'present': bool(title_tag),
        'content': title_content or '',
        'length': len(title_content) if title_content else 0,
        'status': 'pass' if (title_tag and 30 <= len(title_content or '') <= 60) else 'warn'
    }
    
    # Description
    desc_tag = soup.find('meta', attrs={'name': 'description'})
    desc_content = desc_tag.get('content', '') if desc_tag else None
    result['description'] = {
        'present': bool(desc_tag),
        'content': desc_content or '',
        'length': len(desc_content) if desc_content else 0,
        'status': 'pass' if (desc_tag and 120 <= len(desc_content or '') <= 160) else 'fail' if not desc_tag else 'warn'
    }
    
    # Robots
    robots_tag = soup.find('meta', attrs={'name': 'robots'})
    robots_content = robots_tag.get('content', '') if robots_tag else 'index, follow'
    index = 'noindex' not in robots_content.lower()
    follow = 'nofollow' not in robots_content.lower()
    result['robots'] = {
        'index': index,
        'follow': follow,
        'content': robots_content,
        'status': 'pass' if (index and follow) else 'warn'
    }
    
    # Charset
    charset = soup.find('meta', charset=True)
    result['charset'] = {'present': bool(charset)}
    
    # Viewport
    viewport = soup.find('meta', attrs={'name': 'viewport'})
    result['viewport'] = {'present': bool(viewport)}
    
    return result


def _normalize_url_for_compare(u: str) -> str:
    """Normalize a URL for canonical self-reference comparison.

    - Lowercase scheme and host
    - Strip a trailing slash from the path (but keep the root '/')
    - Drop fragment; preserve query as-is
    """
    try:
        p = urlparse(u)
        scheme = (p.scheme or '').lower()
        netloc = (p.netloc or '').lower()
        path = p.path or '/'
        if len(path) > 1 and path.endswith('/'):
            path = path.rstrip('/')
        # Rebuild without fragment
        rebuilt = f"{scheme}://{netloc}{path}"
        if p.query:
            rebuilt += f"?{p.query}"
        return rebuilt
    except Exception:
        return u


def _analyze_canonical(soup: BeautifulSoup, url: Optional[str] = None) -> Dict[str, Any]:
    """Analyze canonical link tag.

    When `url` is provided and a canonical href exists, determine self-reference
    by normalizing both URLs (lowercased scheme/host, trailing-slash stripped,
    relative hrefs resolved against the page URL) and comparing them.

    When `url` is omitted, `self_referencing` is returned as None (unknown) rather
    than guessing.
    """
    canonical = soup.find('link', attrs={'rel': 'canonical'})

    if not canonical:
        return {
            'present': False,
            'href': None,
            'self_referencing': None,
            'status': 'fail'
        }

    href = canonical.get('href', '')

    self_referencing: Optional[bool] = None
    if href and url:
        try:
            resolved = urljoin(url, href)
            self_referencing = _normalize_url_for_compare(resolved) == _normalize_url_for_compare(url)
        except Exception:
            self_referencing = None

    return {
        'present': True,
        'href': href,
        'self_referencing': self_referencing,
        'status': 'pass' if href else 'fail'
    }


def _analyze_open_graph(soup: BeautifulSoup) -> Dict[str, Any]:
    """Check for Open Graph and Twitter Card tags."""
    og_tags = ['og:title', 'og:description', 'og:image', 'og:url']
    result = {}

    og_values: Dict[str, Optional[str]] = {}
    for meta in soup.find_all('meta', attrs={'property': True}):
        prop = meta.get('property', '')
        og_values[prop] = meta.get('content')

    for tag in og_tags:
        result[tag.replace('og:', '')] = bool(og_values.get(tag))

    result['published_time'] = og_values.get('article:published_time')
    result['modified_time'] = og_values.get('article:modified_time')
    result['updated_time'] = og_values.get('og:updated_time')

    # Twitter Card tags (name="twitter:*")
    twitter_values: Dict[str, Optional[str]] = {}
    for meta in soup.find_all('meta', attrs={'name': True}):
        name = meta.get('name', '')
        if name.startswith('twitter:'):
            twitter_values[name] = meta.get('content')

    result['twitter_card'] = {
        'present': bool(twitter_values.get('twitter:card')),
        'card_type': twitter_values.get('twitter:card'),
        'title': bool(twitter_values.get('twitter:title')),
        'image': bool(twitter_values.get('twitter:image')),
        'description': bool(twitter_values.get('twitter:description')),
    }

    return result


def _analyze_indexability(soup: BeautifulSoup, headers: Dict[str, str]) -> Dict[str, Any]:
    """Check for indexability signals and conflicts."""
    signals = []
    blocked = False
    
    # Check meta robots
    robots = soup.find('meta', attrs={'name': 'robots'})
    if robots:
        content = robots.get('content', '').lower()
        if 'noindex' in content:
            blocked = True
            signals.append('meta_noindex')
    
    # Check X-Robots-Tag header
    x_robots = headers.get('X-Robots-Tag', '')
    if x_robots and 'noindex' in x_robots.lower():
        blocked = True
        signals.append('header_noindex')
    
    # Check for conflicts
    conflicts = []
    if blocked and not signals:
        conflicts.append('conflicting_signals')
    
    return {
        'blocked': blocked,
        'signals': signals,
        'conflicts': conflicts
    }


def _analyze_links(soup: BeautifulSoup) -> Dict[str, Any]:
    """Analyze internal and external links."""
    internal_total = 0
    internal_generic = 0
    external_total = 0
    external_broken = 0
    
    generic_anchors = ['click here', 'read more', 'learn more', 'more', 'link', 'here', 'go']
    
    for link in soup.find_all('a', href=True):
        href = link.get('href', '')
        anchor_text = (link.get_text(strip=True) or '').lower()
        
        # Determine if internal or external
        is_internal = href.startswith('/') or href.startswith('#') or 'http' not in href.lower()
        
        if is_internal:
            internal_total += 1
            if anchor_text in generic_anchors or not anchor_text:
                internal_generic += 1
        else:
            external_total += 1
            # Simple check: if href doesn't start with http, might be broken
            if not href.startswith('http'):
                external_broken += 1
    
    return {
        'internal_total': internal_total,
        'internal_generic_anchor': internal_generic,
        'external_total': external_total,
        'external_broken': external_broken
    }


def _analyze_security_headers(headers: Dict[str, str]) -> Dict[str, Any]:
    """Check HTTP response headers for security best practices."""
    security_header_map = {
        'strict-transport-security': 'HSTS',
        'content-security-policy': 'CSP',
        'x-content-type-options': 'X-Content-Type-Options',
        'x-frame-options': 'X-Frame-Options',
        'referrer-policy': 'Referrer-Policy',
        'permissions-policy': 'Permissions-Policy',
    }

    # Normalize header keys to lowercase
    normalized = {k.lower(): v for k, v in headers.items()}

    present = []
    missing = []
    details: Dict[str, str] = {}

    for header_key, header_name in security_header_map.items():
        if header_key in normalized:
            present.append(header_name)
            details[header_name] = normalized[header_key]
        else:
            missing.append(header_name)

    count = len(present)
    if count >= 5:
        grade = 'good'
    elif count >= 3:
        grade = 'moderate'
    else:
        grade = 'weak'

    return {
        'present': present,
        'missing': missing,
        'count': count,
        'grade': grade,
        'details': details,
    }


def _analyze_hreflang(soup: BeautifulSoup) -> Dict[str, Any]:
    """Check for hreflang / internationalisation tags."""
    hreflang_tags = soup.find_all('link', rel='alternate', hreflang=True)

    languages = []
    has_x_default = False

    for tag in hreflang_tags:
        lang = tag.get('hreflang', '')
        href = tag.get('href', '')
        if lang == 'x-default':
            has_x_default = True
        if lang:
            languages.append({'lang': lang, 'href': href})

    present = len(hreflang_tags) > 0
    issues = []
    if present and not has_x_default:
        issues.append('missing_x_default')

    return {
        'present': present,
        'count': len(hreflang_tags),
        'languages': languages,
        'has_x_default': has_x_default,
        'issues': issues,
    }


def _analyze_pagination_amp(soup: BeautifulSoup) -> Dict[str, Any]:
    """Check for pagination rel tags and AMP indicators."""
    # Pagination
    prev_link = soup.find('link', rel='prev')
    next_link = soup.find('link', rel='next')

    # AMP: <link rel="amphtml"> or <html amp> / <html ⚡>
    amp_link = soup.find('link', rel='amphtml')
    html_tag = soup.find('html')
    amp_html = bool(html_tag and (html_tag.has_attr('amp') or html_tag.has_attr('⚡')))

    return {
        'has_prev': bool(prev_link),
        'has_next': bool(next_link),
        'prev_href': prev_link.get('href') if prev_link else None,
        'next_href': next_link.get('href') if next_link else None,
        'is_paginated': bool(prev_link or next_link),
        'amp_link_present': bool(amp_link),
        'amp_html': amp_html,
        'is_amp': bool(amp_link or amp_html),
    }


def main() -> None:
    """
    Read from stdin:
    {
      "html": "...",
      "headers": { ... }
    }

    Output technical SEO analysis JSON.
    """
    try:
        input_data = json.load(sys.stdin)
        html = input_data.get('html', '')
        headers = input_data.get('headers', {})
        url = input_data.get('url')

        if not html.strip():
            result = {
                "meta": {},
                "canonical": {},
                "open_graph": {},
                "indexability": {},
                "links": {}
            }
        else:
            result = analyze_technical_seo(html, headers, url)
        
        json.dump(result, sys.stdout, ensure_ascii=False, separators=(',', ':'))
        sys.stdout.write('\n')
        
    except json.JSONDecodeError as e:
        sys.stderr.write(f"Invalid JSON input: {e}\n")
        sys.exit(1)
    except Exception as e:
        sys.stderr.write(f"Fatal error: {e}\n")
        json.dump({"error": str(e)}, sys.stdout)
        sys.exit(1)


if __name__ == "__main__":
    main()
