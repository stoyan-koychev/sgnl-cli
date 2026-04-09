#!/usr/bin/env python3
"""
xray.py — DOM X-Ray Analysis

Analyzes skeleton HTML and outputs comprehensive DOM structure metrics:
- Element frequency map
- DOM depth analysis
- Semantic coverage
- Structure quality metrics
- Content ratios
- Accessibility audit
- SEO audit
- Links audit
- Images audit
- Forms audit
- Scripts audit
- Inline styles audit
"""

import sys
import json
from typing import Dict, Any, List, Set, Tuple, Optional
from collections import defaultdict
from urllib.parse import urlparse

try:
    from bs4 import BeautifulSoup, NavigableString
except ImportError:
    sys.stderr.write("Error: BeautifulSoup4 required. Install with: pip install beautifulsoup4\n")
    sys.exit(1)


def analyze_dom(html: str, original_html: Optional[str] = None, page_url: Optional[str] = None) -> Dict[str, Any]:
    """Analyze HTML skeleton and extract DOM metrics.
    original_html: the full pre-skeleton HTML, used for metrics that need text/scripts.
    page_url: the page URL, used for first-party vs third-party script detection."""
    try:
        soup = BeautifulSoup(html, 'html.parser')
        original_soup = BeautifulSoup(original_html, 'html.parser') if original_html else None

        # Element frequency map
        element_map = _count_elements(soup)
        total_elements = sum(element_map.values())
        unique_tags = len(element_map)

        # DOM depth analysis
        depth_max, depth_avg, deepest_path = _calculate_depth(soup)

        # Div ratio
        div_count = element_map.get('div', 0)
        div_ratio = div_count / total_elements if total_elements > 0 else 0

        # Semantic coverage
        semantic_tags = ['main', 'header', 'footer', 'nav', 'article', 'section', 'aside']
        semantic_score = sum(1 for tag in semantic_tags if element_map.get(tag, 0) > 0)

        # Heading hierarchy validation
        h_counts = {f'h{i}': element_map.get(f'h{i}', 0) for i in range(1, 7)}
        hierarchy_valid = _validate_heading_hierarchy(soup)

        # Empty element detection
        empty_count = _count_empty_elements(soup)

        # Duplicate ID detection
        duplicate_ids = _check_duplicate_ids(soup)

        # Deprecated tag detection
        deprecated = _find_deprecated_tags(soup)

        # Inline event handlers
        event_count = _count_inline_events(soup)

        # iframe analysis
        iframes_data = _analyze_iframes(soup)

        # Head audit
        head_audit = _audit_head(soup)

        # Content ratios
        content_ratios = _calculate_content_ratios(soup, html, original_html)

        # Accessibility audit
        accessibility = _audit_accessibility(soup)

        # SEO audit

        # Links audit
        links = _audit_links(soup)

        # Images audit
        images = _audit_images(soup)

        # Forms audit
        forms = _audit_forms(soup)

        # Scripts audit
        scripts = _audit_scripts(soup, original_soup, page_url)

        # Inline styles audit
        inline_styles = _audit_inline_styles(soup)

        # Webflow-tier additions (Phase 4)
        tabindex_audit = _audit_tabindex(soup)
        largest_image_candidate = _find_largest_image_candidate(original_soup or soup)
        text_density_by_region = _calculate_text_density_by_region(original_soup or soup)
        duplicate_headings = _find_duplicate_headings(original_soup or soup)

        return {
            "dom": {
                "total_elements": total_elements,
                "unique_tags": unique_tags,
                "depth_max": depth_max,
                "depth_avg": round(depth_avg, 1),
                "deepest_path": deepest_path
            },
            "element_map": dict(sorted(element_map.items(), key=lambda x: x[1], reverse=True)),
            "structure": {
                "div_ratio": round(div_ratio, 2),
                "semantic_score": semantic_score,
                "h1_count": h_counts['h1'],
                "h2_count": h_counts['h2'],
                "h3_count": h_counts['h3'],
                "heading_hierarchy_valid": hierarchy_valid,
                "empty_elements": empty_count,
                "duplicate_ids": len(duplicate_ids),
                "deprecated_tags": deprecated,
                "inline_event_handlers": event_count,
                "iframes": iframes_data
            },
            "head": head_audit,
            "content_ratios": content_ratios,
            "accessibility": accessibility,
            "links": links,
            "images": images,
            "forms": forms,
            "scripts": scripts,
            "inline_styles": inline_styles,
            "tabindex_audit": tabindex_audit,
            "largest_image_candidate": largest_image_candidate,
            "text_density_by_region": text_density_by_region,
            "duplicate_headings": duplicate_headings
        }
    except Exception as e:
        sys.stderr.write(f"Error analyzing DOM: {e}\n")
        return {}


def _count_elements(soup: BeautifulSoup) -> Dict[str, int]:
    """Count all elements by tag type, excluding head-only and SVG tags."""
    HEAD_ONLY = {'meta', 'link', 'title', 'base', 'head'}
    counts = defaultdict(int)
    for tag in soup.find_all(True):
        if tag.name not in HEAD_ONLY:
            counts[tag.name] += 1
    return dict(counts)


def _calculate_depth(soup: BeautifulSoup) -> Tuple[int, float, List[str]]:
    """Calculate max depth, average depth, and deepest path."""
    max_depth = 0
    depths = []
    deepest_path = []

    def traverse(element, depth: int, path: List[str]) -> None:
        nonlocal max_depth, deepest_path

        if depth > max_depth:
            max_depth = depth
            deepest_path = path.copy()

        if hasattr(element, 'children'):
            for child in element.children:
                if hasattr(child, 'name') and child.name:
                    depths.append(depth)
                    traverse(child, depth + 1, path + [child.name])

    if soup.body:
        traverse(soup.body, 0, ['body'])
    else:
        traverse(soup, 0, ['root'])

    avg_depth = sum(depths) / len(depths) if depths else 0

    return max_depth, avg_depth, deepest_path


def _validate_heading_hierarchy(soup: BeautifulSoup) -> bool:
    """Validate heading hierarchy (no skipped levels, H1 present exactly once)."""
    headings = [int(tag.name[1]) for tag in soup.find_all(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])]

    if not headings:
        return False

    if headings.count(1) != 1:
        return False

    # Check for broken hierarchy (skipping levels)
    for i in range(len(headings) - 1):
        if headings[i+1] > headings[i] + 1:
            return False

    return True


def _count_empty_elements(soup: BeautifulSoup) -> int:
    """Count elements with no children or text."""
    count = 0
    for tag in soup.find_all(True):
        if not tag.contents or (len(tag.contents) == 1 and isinstance(tag.contents[0], NavigableString) and not tag.contents[0].strip()):
            count += 1
    return count


def _check_duplicate_ids(soup: BeautifulSoup) -> Set[str]:
    """Find duplicate IDs in the document."""
    ids = {}
    duplicates = set()

    for tag in soup.find_all(id=True):
        tag_id = tag.get('id')
        if tag_id in ids:
            duplicates.add(tag_id)
        else:
            ids[tag_id] = tag

    return duplicates


def _find_deprecated_tags(soup: BeautifulSoup) -> List[str]:
    """Find deprecated HTML tags (font, center, marquee, etc.)."""
    deprecated_list = ['font', 'center', 'marquee', 'applet', 'frameset', 'frame', 'strike', 'u']
    found = []

    for tag_name in deprecated_list:
        if soup.find_all(tag_name):
            found.append(tag_name)

    return found


def _count_inline_events(soup: BeautifulSoup) -> int:
    """Count inline event handlers (onclick, onload, etc.)."""
    event_attrs = ['onclick', 'onload', 'onmouseover', 'onmouseout', 'onchange', 'onfocus', 'onblur']
    count = 0

    for tag in soup.find_all(True):
        for attr in event_attrs:
            if tag.get(attr):
                count += 1

    return count


def _analyze_iframes(soup: BeautifulSoup) -> Dict[str, Any]:
    """Analyze iframes and extract source domains."""
    iframes = soup.find_all('iframe')
    domains = set()

    for iframe in iframes:
        src = iframe.get('src', '')
        if src:
            try:
                parsed = urlparse(src)
                if parsed.netloc:
                    domains.add(parsed.netloc)
            except:
                pass

    return {
        "count": len(iframes),
        "domains": sorted(list(domains))
    }


def _audit_head(soup: BeautifulSoup) -> Dict[str, Any]:
    """Audit <head> section for important tags."""
    head = soup.head
    if not head:
        return {
            "charset_present": False,
            "viewport_present": False,
            "favicon_present": False,
            "preload_count": 0
        }

    charset = bool(head.find('meta', charset=True))
    viewport = bool(head.find('meta', attrs={'name': 'viewport'}))
    favicon = bool(head.find('link', attrs={'rel': 'icon'}) or head.find('link', attrs={'rel': 'shortcut icon'}))
    preload_count = len(head.find_all('link', attrs={'rel': 'preload'}))

    return {
        "charset_present": charset,
        "viewport_present": viewport,
        "favicon_present": favicon,
        "preload_count": preload_count
    }


def _calculate_content_ratios(soup: BeautifulSoup, html: str, original_html: Optional[str] = None) -> Dict[str, Any]:
    """Calculate content size and text-to-HTML ratios.
    Uses original_html (pre-skeleton) for text metrics when available,
    since skeleton has all text stripped."""
    source_html = original_html or html
    if original_html:
        source_soup = BeautifulSoup(original_html, 'html.parser')
        # Remove script/style for cleaner text extraction
        for tag in source_soup(['script', 'style']):
            tag.decompose()
        text = source_soup.get_text(separator=' ', strip=True)
    else:
        text = soup.get_text(separator=' ', strip=True)

    html_size_kb = round(len(source_html.encode('utf-8')) / 1024, 2)
    word_count = len(text.split()) if text else 0
    ratio = round(len(text) / len(source_html), 2) if len(source_html) > 0 else 0

    return {
        "html_size_kb": html_size_kb,
        "word_count_approx": word_count,
        "html_text_ratio": ratio
    }


def _audit_accessibility(soup: BeautifulSoup) -> Dict[str, Any]:
    """Audit accessibility: alt text, labels, lang, ARIA attributes."""
    # Images missing alt attribute
    imgs = soup.find_all('img')
    images_missing_alt = len([img for img in imgs if not img.has_attr('alt')])

    # Inputs without associated label (exclude hidden inputs)
    label_fors = {label.get('for') for label in soup.find_all('label') if label.get('for')}
    inputs_without_label = 0
    for inp in soup.find_all('input'):
        if inp.get('type') == 'hidden':
            continue
        inp_id = inp.get('id')
        has_label_for = inp_id and inp_id in label_fors
        has_parent_label = inp.find_parent('label') is not None
        if not has_label_for and not has_parent_label:
            inputs_without_label += 1

    # Buttons and links with no visible text
    buttons_links_no_text = 0
    for tag in soup.find_all(['button', 'a']):
        text = tag.get_text(strip=True)
        aria_label = tag.get('aria-label', '').strip()
        if not text and not aria_label:
            buttons_links_no_text += 1

    # HTML missing lang attribute
    html_tag = soup.find('html')
    html_missing_lang = not (html_tag and html_tag.has_attr('lang'))

    # Count all aria-* attributes
    aria_count = 0
    for tag in soup.find_all(True):
        for attr in tag.attrs:
            if attr.startswith('aria-'):
                aria_count += 1

    return {
        "images_missing_alt": images_missing_alt,
        "inputs_without_label": inputs_without_label,
        "buttons_links_no_text": buttons_links_no_text,
        "html_missing_lang": html_missing_lang,
        "aria_attribute_count": aria_count
    }



def _audit_links(soup: BeautifulSoup) -> Dict[str, Any]:
    """Audit links: total, internal/external ratio, target=_blank safety."""
    anchors = soup.find_all('a', href=True)
    internal = 0
    external = 0
    target_blank_missing_rel = 0

    for a in anchors:
        href = a.get('href', '')
        parsed = urlparse(href)
        if parsed.scheme in ('http', 'https') and parsed.netloc:
            external += 1
        else:
            internal += 1

        if a.get('target') == '_blank':
            rel = a.get('rel', [])
            if isinstance(rel, str):
                rel = rel.split()
            if 'noopener' not in rel or 'noreferrer' not in rel:
                target_blank_missing_rel += 1

    return {
        "total": len(anchors),
        "internal": internal,
        "external": external,
        "target_blank_missing_rel": target_blank_missing_rel
    }


def _audit_images(soup: BeautifulSoup) -> Dict[str, Any]:
    """Audit images: total, missing alt, missing dimensions, lazy loading."""
    imgs = soup.find_all('img')
    missing_alt = len([img for img in imgs if not img.has_attr('alt')])
    missing_dims = len([img for img in imgs if not img.has_attr('width') or not img.has_attr('height')])
    lazy = len([img for img in imgs if img.get('loading') == 'lazy'])

    return {
        "total": len(imgs),
        "missing_alt": missing_alt,
        "missing_dimensions": missing_dims,
        "lazy_loaded": lazy
    }


def _audit_forms(soup: BeautifulSoup) -> Dict[str, Any]:
    """Audit forms: counts, labels, missing action."""
    forms = soup.find_all('form')
    inputs = soup.find_all('input')
    buttons = soup.find_all('button')

    # Inputs without labels
    label_fors = {label.get('for') for label in soup.find_all('label') if label.get('for')}
    inputs_without_labels = 0
    for inp in inputs:
        if inp.get('type') == 'hidden':
            continue
        inp_id = inp.get('id')
        has_label_for = inp_id and inp_id in label_fors
        has_parent_label = inp.find_parent('label') is not None
        if not has_label_for and not has_parent_label:
            inputs_without_labels += 1

    forms_missing_action = len([f for f in forms if not f.has_attr('action')])

    return {
        "form_count": len(forms),
        "input_count": len(inputs),
        "button_count": len(buttons),
        "inputs_without_labels": inputs_without_labels,
        "forms_missing_action": forms_missing_action
    }


_ANALYTICS_DOMAINS = {
    'www.google-analytics.com', 'google-analytics.com', 'www.googletagmanager.com',
    'googletagmanager.com', 'analytics.google.com', 'snap.licdn.com',
    'static.hotjar.com', 'js.hs-analytics.net', 'cdn.segment.com',
    'plausible.io', 'cdn.mxpnl.com', 'js.hs-scripts.com',
}
_ADS_DOMAINS = {
    'pagead2.googlesyndication.com', 'adservice.google.com',
    'securepubads.g.doubleclick.net', 'ads.twitter.com',
    'www.googleadservices.com', 'connect.facebook.net',
    'static.ads-twitter.com', 'platform.twitter.com',
}
_CDN_DOMAINS = {
    'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com',
    'ajax.googleapis.com', 'cdn.shopify.com', 'assets.squarespace.com',
    'stackpath.bootstrapcdn.com', 'code.jquery.com',
}
_SOCIAL_DOMAINS = {
    'platform.twitter.com', 'connect.facebook.net', 'platform.linkedin.com',
    'widgets.pinterest.com', 'platform.instagram.com', 'apis.google.com',
}
_TAG_MANAGER_DOMAINS = {
    'www.googletagmanager.com', 'googletagmanager.com',
    'tags.tiqcdn.com', 'assets.adobedtm.com', 'cdn.cookielaw.org',
}


def _audit_scripts(soup: BeautifulSoup, original_soup: Optional[BeautifulSoup] = None, page_url: Optional[str] = None) -> Dict[str, Any]:
    """Audit scripts: inline vs external, defer/async, third-party categorization.
    Uses original_soup when available since skeleton strips script tags."""
    check_soup = original_soup or soup
    scripts = check_soup.find_all('script')
    external_scripts = [s for s in scripts if s.has_attr('src')]
    external = len(external_scripts)
    inline = len(scripts) - external
    defer_count = len([s for s in scripts if s.has_attr('defer')])
    async_count = len([s for s in scripts if s.has_attr('async')])

    # Third-party analysis
    page_domain = ''
    if page_url:
        try:
            page_domain = urlparse(page_url).netloc.lower()
        except Exception:
            pass

    third_party_domains: List[str] = []
    categories: Dict[str, List[str]] = {
        'analytics': [], 'ads': [], 'cdn': [], 'social': [], 'other': []
    }

    for script in external_scripts:
        src = script.get('src', '')
        try:
            parsed = urlparse(src)
            domain = parsed.netloc.lower()
            if not domain:
                continue
            # Skip first-party
            if page_domain and (domain == page_domain or domain.endswith('.' + page_domain)):
                continue

            if domain not in third_party_domains:
                third_party_domains.append(domain)

            # Categorize
            if domain in _ANALYTICS_DOMAINS:
                if domain not in categories['analytics']:
                    categories['analytics'].append(domain)
            elif domain in _ADS_DOMAINS:
                if domain not in categories['ads']:
                    categories['ads'].append(domain)
            elif domain in _CDN_DOMAINS:
                if domain not in categories['cdn']:
                    categories['cdn'].append(domain)
            elif domain in _SOCIAL_DOMAINS:
                if domain not in categories['social']:
                    categories['social'].append(domain)
            else:
                if domain not in categories['other']:
                    categories['other'].append(domain)
        except Exception:
            continue

    tag_manager_detected = any(d in _TAG_MANAGER_DOMAINS for d in third_party_domains)

    result: Dict[str, Any] = {
        "total": len(scripts),
        "inline": inline,
        "external": external,
        "defer_count": defer_count,
        "async_count": async_count,
        "third_party": {
            "count": len(third_party_domains),
            "domains": third_party_domains,
            "categories": {k: v for k, v in categories.items() if v},
            "tag_manager_detected": tag_manager_detected,
        },
    }
    return result


def _audit_inline_styles(soup: BeautifulSoup) -> Dict[str, Any]:
    """Count elements with inline style attributes."""
    return {
        "count": len(soup.find_all(style=True))
    }


def _audit_tabindex(soup: BeautifulSoup) -> Dict[str, Any]:
    """Count elements with positive tabindex values (a11y smell)."""
    positive_count = 0
    for tag in soup.find_all(attrs={'tabindex': True}):
        try:
            val = int(str(tag.get('tabindex', '')).strip())
            if val > 0:
                positive_count += 1
        except (ValueError, TypeError):
            continue
    return {"positive_tabindex_count": positive_count}


def _find_largest_image_candidate(soup: BeautifulSoup) -> Optional[Dict[str, Any]]:
    """Find the first <img> in <main> or <body> with largest declared width*height.
    Returns {src, width, height} or None. Static LCP heuristic."""
    container = soup.find('main') or soup.find('body') or soup
    if not container:
        return None
    best = None
    best_area = 0
    for img in container.find_all('img'):
        try:
            w = int(str(img.get('width', '0')).strip() or '0')
            h = int(str(img.get('height', '0')).strip() or '0')
        except (ValueError, TypeError):
            continue
        area = w * h
        if area > best_area:
            best_area = area
            best = {
                'src': img.get('src', '') or img.get('data-src', '') or '',
                'width': w,
                'height': h,
            }
    return best


def _calculate_text_density_by_region(soup: BeautifulSoup) -> Dict[str, int]:
    """Word count per semantic region. 0 if region missing."""
    result = {'main': 0, 'aside': 0, 'footer': 0, 'header': 0}
    for region in ('main', 'aside', 'footer', 'header'):
        tag = soup.find(region)
        if tag:
            text = tag.get_text(separator=' ', strip=True)
            result[region] = len(text.split()) if text else 0
    return result


def _find_duplicate_headings(soup: BeautifulSoup) -> List[str]:
    """Return top 5 heading texts that appear 2+ times (case-insensitive)."""
    counts: Dict[str, int] = defaultdict(int)
    originals: Dict[str, str] = {}
    for tag in soup.find_all(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']):
        text = tag.get_text(strip=True)
        if not text:
            continue
        key = text.lower()
        counts[key] += 1
        if key not in originals:
            originals[key] = text
    duplicates = [(originals[k], c) for k, c in counts.items() if c >= 2]
    duplicates.sort(key=lambda x: x[1], reverse=True)
    return [text for text, _ in duplicates[:5]]


def main() -> None:
    """Read HTML from stdin (JSON or raw skeleton), output DOM analysis JSON."""
    try:
        raw_input = sys.stdin.read()

        # Try JSON input: {"skeleton": "...", "html": "...", "url": "..."}
        skeleton = None
        original_html = None
        page_url = None
        try:
            data = json.loads(raw_input)
            if isinstance(data, dict) and 'skeleton' in data:
                skeleton = data['skeleton']
                original_html = data.get('html')
                page_url = data.get('url')
        except (json.JSONDecodeError, ValueError):
            # Backward compat: raw skeleton string
            skeleton = raw_input

        if not skeleton or not skeleton.strip():
            result = {
                "dom": {"total_elements": 0, "unique_tags": 0, "depth_max": 0, "depth_avg": 0, "deepest_path": []},
                "element_map": {},
                "structure": {},
                "head": {},
                "content_ratios": {"html_size_kb": 0, "word_count_approx": 0, "html_text_ratio": 0},
                "accessibility": {},
                "links": {"total": 0, "internal": 0, "external": 0, "target_blank_missing_rel": 0},
                "images": {"total": 0, "missing_alt": 0, "missing_dimensions": 0, "lazy_loaded": 0},
                "forms": {"form_count": 0, "input_count": 0, "button_count": 0, "inputs_without_labels": 0, "forms_missing_action": 0},
                "scripts": {"total": 0, "inline": 0, "external": 0, "defer_count": 0, "async_count": 0},
                "inline_styles": {"count": 0},
                "tabindex_audit": {"positive_tabindex_count": 0},
                "largest_image_candidate": None,
                "text_density_by_region": {"main": 0, "aside": 0, "footer": 0, "header": 0},
                "duplicate_headings": []
            }
        else:
            result = analyze_dom(skeleton, original_html, page_url)

        json.dump(result, sys.stdout, ensure_ascii=False, separators=(',', ':'))
        sys.stdout.write('\n')

    except Exception as e:
        sys.stderr.write(f"Fatal error: {e}\n")
        json.dump({"error": str(e)}, sys.stdout)
        sys.exit(1)


if __name__ == "__main__":
    main()
