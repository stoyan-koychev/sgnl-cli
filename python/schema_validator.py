#!/usr/bin/env python3
"""
schema_validator.py — Schema.org JSON-LD Validator

Extracts JSON-LD blocks from HTML, validates against schema.org specs,
checks Google Rich Results eligibility, scores markup, and generates
actionable recommendations.

Input (JSON via stdin):  { "html": "<html>..." }
Output (JSON via stdout): SchemaReport
"""

import sys
import json
import re
from typing import Any, Dict, List, Optional, Tuple

try:
    from bs4 import BeautifulSoup
except ImportError:
    sys.stderr.write("Error: BeautifulSoup4 required. Install with: pip install beautifulsoup4\n")
    sys.exit(1)


# ── Required fields per schema type (Google Rich Results documentation) ──

SCHEMA_REQUIRED_FIELDS: Dict[str, List[str]] = {
    'Article':        ['headline', 'image', 'author', 'datePublished', 'publisher'],
    'NewsArticle':    ['headline', 'image', 'author', 'datePublished', 'publisher'],
    'BlogPosting':    ['headline', 'image', 'author', 'datePublished'],
    'Product':        ['name', 'image', 'offers'],
    'FAQPage':        ['mainEntity'],
    'BreadcrumbList': ['itemListElement'],
    'Recipe':         ['name', 'image', 'recipeIngredient', 'recipeInstructions'],
    'Event':          ['name', 'startDate', 'location'],
    'LocalBusiness':  ['name', 'address'],
    'Person':         ['name'],
    'Organization':   ['name', 'url'],
    'WebPage':        ['name'],
    'HowTo':          ['name', 'step'],
    'Review':         ['itemReviewed', 'reviewRating', 'author'],
    'VideoObject':    ['name', 'description', 'thumbnailUrl', 'uploadDate'],
    'WebSite':        ['name', 'url'],
}

SCHEMA_RECOMMENDED_FIELDS: Dict[str, List[str]] = {
    'Article':        ['dateModified', 'mainEntityOfPage', 'description', 'inLanguage'],
    'NewsArticle':    ['dateModified', 'mainEntityOfPage', 'description', 'inLanguage'],
    'BlogPosting':    ['publisher', 'dateModified', 'mainEntityOfPage', 'inLanguage'],
    'Product':        ['description', 'brand', 'sku', 'aggregateRating', 'review'],
    'FAQPage':        ['name', 'description'],
    'BreadcrumbList': [],
    'Recipe':         ['cookTime', 'prepTime', 'nutrition', 'author', 'aggregateRating'],
    'Event':          ['endDate', 'image', 'description', 'offers', 'organizer'],
    'LocalBusiness':  ['telephone', 'openingHours', 'image', 'url', 'geo'],
    'Person':         ['url', 'image', 'jobTitle', 'sameAs'],
    'Organization':   ['logo', 'sameAs', 'contactPoint'],
    'WebPage':        ['description', 'url', 'datePublished', 'inLanguage'],
    'HowTo':          ['image', 'totalTime', 'supply', 'tool'],
    'Review':         ['datePublished', 'reviewBody'],
    'VideoObject':    ['contentUrl', 'embedUrl', 'duration'],
    'WebSite':        ['potentialAction'],
}

# Rich Results eligibility: type → (eligible_result_name, extra_required_fields_beyond_SCHEMA_REQUIRED)
RICH_RESULTS_RULES: Dict[str, Tuple[str, List[str]]] = {
    'Article':        ('Article rich result',       []),
    'NewsArticle':    ('Top stories / Article',     []),
    'BlogPosting':    ('Article rich result',       []),
    'Product':        ('Product snippet',           []),  # needs offers with price OR aggregateRating
    'FAQPage':        ('FAQ rich result',           []),
    'BreadcrumbList': ('Breadcrumb trail',          []),
    'Recipe':         ('Recipe rich result',        []),
    'Event':          ('Event rich result',         []),
    'LocalBusiness':  ('Local business panel',      []),
    'HowTo':          ('How-to rich result',        []),
    'Review':         ('Review snippet',            []),
    'VideoObject':    ('Video rich result',         []),
}

# Fields whose values should be URLs
URL_FIELDS = {
    'url', 'image', 'logo', 'thumbnailUrl', 'contentUrl', 'embedUrl',
    'mainEntityOfPage', 'sameAs',
}

# Fields whose values should be ISO 8601 dates
DATE_FIELDS = {
    'datePublished', 'dateModified', 'dateCreated', 'startDate', 'endDate',
    'uploadDate',
}

# Fields whose values should be ISO 8601 durations
DURATION_FIELDS = {'duration', 'cookTime', 'prepTime', 'totalTime'}

# Fields that should be objects (not plain strings)
OBJECT_FIELDS = {'author', 'publisher', 'organizer', 'performer'}

# Types eligible for the `inLanguage` recommendation
INLANGUAGE_TYPES = {'Article', 'NewsArticle', 'BlogPosting', 'WebPage'}


# ── Format validators ───────────────────────────────────────────────────

def _is_valid_url(value: Any) -> bool:
    if isinstance(value, dict):
        # Nested object with @id or url
        return True
    if isinstance(value, list):
        return all(_is_valid_url(v) for v in value) if value else True
    if not isinstance(value, str):
        return False
    return value.startswith('http://') or value.startswith('https://')


def _is_valid_iso_date(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    return bool(re.match(r'^\d{4}-\d{2}-\d{2}', value))


def _is_valid_duration(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    return bool(re.match(r'^P(T?\d+[HMSD])+$', value, re.IGNORECASE))


def _validate_field_format(field: str, value: Any) -> List[Dict[str, str]]:
    """Validate a field's value format. Returns list of error dicts."""
    errors: List[Dict[str, str]] = []

    if value is None or value == '' or value == []:
        return errors

    # URL fields
    if field in URL_FIELDS and not _is_valid_url(value):
        str_val = str(value)[:100]
        errors.append({
            'field': field,
            'value': str_val,
            'expected': 'Valid URL (http:// or https://)',
            'message': f"'{field}' is not a valid URL",
        })

    # Date fields
    if field in DATE_FIELDS and not _is_valid_iso_date(value):
        str_val = str(value)[:100]
        errors.append({
            'field': field,
            'value': str_val,
            'expected': 'ISO 8601 date (YYYY-MM-DD or YYYY-MM-DDThh:mm:ss)',
            'message': f"'{field}' is not a valid ISO 8601 date",
        })

    # Duration fields
    if field in DURATION_FIELDS and not _is_valid_duration(value):
        str_val = str(value)[:100]
        errors.append({
            'field': field,
            'value': str_val,
            'expected': 'ISO 8601 duration (e.g., PT30M, PT1H30M)',
            'message': f"'{field}' is not a valid ISO 8601 duration",
        })

    return errors


def _validate_context(data: Dict[str, Any]) -> Tuple[List[Dict[str, str]], List[Dict[str, str]]]:
    """Validate @context field. Returns (format_errors, warnings)."""
    errors: List[Dict[str, str]] = []
    warnings: List[Dict[str, str]] = []
    ctx = data.get('@context')

    if ctx is None:
        errors.append({
            'field': '@context',
            'value': '',
            'expected': 'https://schema.org',
            'message': "'@context' is missing (should be 'https://schema.org')",
        })
        return errors, warnings

    # @context can be a string or an array (or object for advanced usage)
    def _contains_schema_org(v: Any) -> Tuple[bool, bool]:
        """Returns (matches_https, matches_http)."""
        if isinstance(v, str):
            stripped = v.rstrip('/')
            return (stripped == 'https://schema.org', stripped == 'http://schema.org')
        if isinstance(v, list):
            https = any(_contains_schema_org(item)[0] for item in v)
            http = any(_contains_schema_org(item)[1] for item in v)
            return (https, http)
        if isinstance(v, dict):
            # Some pages use an @vocab key
            vocab = v.get('@vocab')
            if isinstance(vocab, str):
                stripped = vocab.rstrip('/')
                return (stripped == 'https://schema.org', stripped == 'http://schema.org')
        return (False, False)

    has_https, has_http = _contains_schema_org(ctx)
    if has_https:
        return errors, warnings
    if has_http:
        warnings.append({
            'field': '@context',
            'message': "'@context' uses 'http://schema.org'; prefer 'https://schema.org'",
        })
        return errors, warnings

    errors.append({
        'field': '@context',
        'value': str(ctx)[:100],
        'expected': 'https://schema.org',
        'message': "'@context' does not reference schema.org",
    })
    return errors, warnings


def _check_structural_warnings(data: Dict[str, Any]) -> List[Dict[str, str]]:
    """Check for structural issues like strings instead of objects."""
    warnings: List[Dict[str, str]] = []

    # OBJECT_FIELDS: author/publisher/organizer/performer
    for field in OBJECT_FIELDS:
        value = data.get(field)
        if value is None:
            continue
        items = value if isinstance(value, list) else [value]
        for i, item in enumerate(items):
            prefix = f"{field}[{i}]" if isinstance(value, list) else f"{field}"
            if isinstance(item, str):
                warnings.append({
                    'field': field,
                    'message': f"'{prefix}' should be a Person or Organization object, not a plain string",
                })
                continue
            if not isinstance(item, dict):
                continue
            # Nested completeness: Person needs name; Organization needs name + logo
            item_type = item.get('@type', '')
            item_types = item_type if isinstance(item_type, list) else [item_type]
            if not item.get('name'):
                warnings.append({
                    'field': field,
                    'message': f"'{prefix}' is missing 'name'",
                })
            if 'Organization' in item_types and not item.get('logo'):
                warnings.append({
                    'field': field,
                    'message': f"'{prefix}' (Organization) is missing 'logo'",
                })

    # Product: check offers structure
    offers = data.get('offers')
    if offers is not None:
        offer_list = offers if isinstance(offers, list) else [offers]
        for offer in offer_list:
            if isinstance(offer, dict):
                if not offer.get('price') and not offer.get('lowPrice'):
                    warnings.append({
                        'field': 'offers',
                        'message': "'offers' is missing 'price' or 'lowPrice'",
                    })
                pc = offer.get('priceCurrency')
                if not pc:
                    warnings.append({
                        'field': 'offers',
                        'message': "'offers' is missing 'priceCurrency'",
                    })
                elif isinstance(pc, str) and not re.match(r'^[A-Z]{3}$', pc):
                    warnings.append({
                        'field': 'offers',
                        'message': f"'priceCurrency' '{pc}' is not a valid ISO 4217 code (3 uppercase letters)",
                    })

    # FAQPage: check mainEntity structure
    schema_type = data.get('@type', '')
    types = schema_type if isinstance(schema_type, list) else [schema_type]
    if 'FAQPage' in types:
        main_entity = data.get('mainEntity')
        if main_entity is not None:
            questions = main_entity if isinstance(main_entity, list) else [main_entity]
            for i, q in enumerate(questions):
                if not isinstance(q, dict):
                    warnings.append({
                        'field': 'mainEntity',
                        'message': f"mainEntity[{i}] should be a Question object",
                    })
                elif not q.get('acceptedAnswer'):
                    warnings.append({
                        'field': 'mainEntity',
                        'message': f"mainEntity[{i}] (Question) is missing 'acceptedAnswer'",
                    })

    # ReviewRating: check ratingValue
    review_rating = data.get('reviewRating')
    if isinstance(review_rating, dict) and not review_rating.get('ratingValue'):
        warnings.append({
            'field': 'reviewRating',
            'message': "'reviewRating' is missing 'ratingValue'",
        })

    # aggregateRating sanity
    ar = data.get('aggregateRating')
    if isinstance(ar, dict):
        rv = ar.get('ratingValue')
        if rv is None:
            warnings.append({
                'field': 'aggregateRating',
                'message': "'aggregateRating' is missing 'ratingValue'",
            })
        else:
            try:
                rv_num = float(rv)
                best = float(ar.get('bestRating', 5))
                worst = float(ar.get('worstRating', 1))
                if rv_num < worst or rv_num > best:
                    warnings.append({
                        'field': 'aggregateRating',
                        'message': f"'aggregateRating.ratingValue' {rv_num} is outside [{worst}, {best}]",
                    })
            except (TypeError, ValueError):
                pass
        if not ar.get('reviewCount') and not ar.get('ratingCount'):
            warnings.append({
                'field': 'aggregateRating',
                'message': "'aggregateRating' should include 'reviewCount' or 'ratingCount'",
            })

    return warnings


def _check_image_shape_recommendations(data: Dict[str, Any]) -> List[Dict[str, str]]:
    """Recommend ImageObject shape for bare string images."""
    recs: List[Dict[str, str]] = []
    image = data.get('image')
    if image is None:
        return recs
    items = image if isinstance(image, list) else [image]
    has_bare_string = any(isinstance(v, str) for v in items)
    has_imageobject_with_dims = False
    for v in items:
        if isinstance(v, dict):
            t = v.get('@type', '')
            tl = t if isinstance(t, list) else [t]
            if 'ImageObject' in tl and v.get('width') and v.get('height'):
                has_imageobject_with_dims = True
                break
    if has_bare_string and not has_imageobject_with_dims:
        recs.append({
            'field': 'image',
            'message': "Use ImageObject with 'width' and 'height' for rich results",
        })
    return recs


# ── Core extraction and validation ──────────────────────────────────────

def _extract_jsonld_blocks(html: str) -> List[Dict[str, Any]]:
    """Extract and parse all JSON-LD blocks from HTML, flattening @graph."""
    soup = BeautifulSoup(html, 'html.parser')
    scripts = soup.find_all('script', attrs={'type': 'application/ld+json'})

    blocks: List[Dict[str, Any]] = []
    for script in scripts:
        try:
            data = json.loads(script.string or '{}')
        except (json.JSONDecodeError, TypeError):
            blocks.append({'_parse_error': True, '_raw': str(script.string or '')[:500]})
            continue

        # Handle @graph arrays (WordPress/Yoast pattern)
        if isinstance(data, dict) and '@graph' in data:
            graph = data['@graph']
            if isinstance(graph, list):
                for item in graph:
                    if isinstance(item, dict):
                        blocks.append(item)
            continue

        # Handle top-level arrays
        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict):
                    blocks.append(item)
            continue

        if isinstance(data, dict):
            blocks.append(data)

    return blocks


def _resolve_type(data: Dict[str, Any]) -> List[str]:
    """Resolve @type to a list of type strings."""
    schema_type = data.get('@type', 'Unknown')
    if isinstance(schema_type, list):
        return [str(t) for t in schema_type]
    return [str(schema_type)]


def _validate_block(data: Dict[str, Any], primary_type: str) -> Dict[str, Any]:
    """Validate a single JSON-LD block against required/recommended fields."""
    types = _resolve_type(data)

    # Merge required fields from all types
    all_required: List[str] = []
    all_recommended: List[str] = []
    for t in types:
        all_required.extend(SCHEMA_REQUIRED_FIELDS.get(t, []))
        all_recommended.extend(SCHEMA_RECOMMENDED_FIELDS.get(t, []))

    # Deduplicate, remove recommended that are already required
    all_required = list(dict.fromkeys(all_required))
    all_recommended = [f for f in dict.fromkeys(all_recommended) if f not in all_required]

    # Check presence
    req_present = [f for f in all_required if data.get(f)]
    req_missing = [f for f in all_required if not data.get(f)]
    rec_present = [f for f in all_recommended if data.get(f)]
    rec_missing = [f for f in all_recommended if not data.get(f)]

    # Format validation on all present fields
    format_errors: List[Dict[str, str]] = []
    for key, value in data.items():
        if key.startswith('@'):
            continue
        format_errors.extend(_validate_field_format(key, value))

    # @context validation
    ctx_errors, ctx_warnings = _validate_context(data)
    format_errors.extend(ctx_errors)

    # Structural warnings
    warnings = _check_structural_warnings(data)
    warnings.extend(ctx_warnings)

    return {
        'required': {
            'fields': all_required,
            'present': req_present,
            'missing': req_missing,
        },
        'recommended': {
            'fields': all_recommended,
            'present': rec_present,
            'missing': rec_missing,
        },
        'format_errors': format_errors,
        'warnings': warnings,
    }


def _compute_block_score(validation: Dict[str, Any]) -> int:
    """Compute a 0-100 score for a block from its validation output."""
    req_missing = len(validation.get('required', {}).get('missing', []))
    rec_missing = len(validation.get('recommended', {}).get('missing', []))
    fmt_errors = len(validation.get('format_errors', []))
    warns = len(validation.get('warnings', []))
    score = 100 - 20 * req_missing - 5 * rec_missing - 10 * fmt_errors - 5 * warns
    return max(0, score)


def _check_rich_results(data: Dict[str, Any], primary_type: str) -> Dict[str, Any]:
    """Check if block is eligible for Google Rich Results."""
    types = _resolve_type(data)

    eligible_results: List[str] = []
    missing_for: List[str] = []

    for t in types:
        rule = RICH_RESULTS_RULES.get(t)
        if not rule:
            continue

        result_name, extra_required = rule
        base_required = SCHEMA_REQUIRED_FIELDS.get(t, [])
        all_needed = base_required + extra_required

        missing = [f for f in all_needed if not data.get(f)]

        # Special cases
        if t == 'Product':
            has_offers_with_price = False
            offers = data.get('offers')
            if offers:
                offer_list = offers if isinstance(offers, list) else [offers]
                for o in offer_list:
                    if isinstance(o, dict) and (o.get('price') or o.get('lowPrice')):
                        has_offers_with_price = True
                        break
            has_rating = bool(data.get('aggregateRating'))
            if not has_offers_with_price and not has_rating:
                if 'offers' not in missing:
                    missing.append('offers (with price) or aggregateRating')

        if t == 'BreadcrumbList':
            items = data.get('itemListElement', [])
            if isinstance(items, list) and len(items) < 2:
                missing.append('itemListElement (need 2+ items)')

        if t == 'VideoObject':
            if not data.get('contentUrl') and not data.get('embedUrl'):
                missing.append('contentUrl or embedUrl')

        if not missing:
            eligible_results.append(result_name)
        else:
            missing_for.extend(missing)

    return {
        'eligible': len(eligible_results) > 0,
        'types': eligible_results,
        'missing_for_eligibility': list(dict.fromkeys(missing_for)),
    }



def _generate_recommendations(
    validated_blocks: List[Dict[str, Any]],
    page_level: Optional[List[Dict[str, str]]] = None,
) -> List[Dict[str, str]]:
    """Generate prioritized recommendations from all validated blocks."""
    recs: List[Dict[str, str]] = []

    for block in validated_blocks:
        btype = block['type']
        validation = block['validation']

        # High priority: missing required fields
        for field in validation['required']['missing']:
            hint = ''
            if field == 'publisher':
                hint = " with @type Organization, name, and logo"
            elif field == 'image':
                hint = " — required for rich results"
            elif field == 'author':
                hint = " with @type Person and name"
            recs.append({
                'priority': 'high',
                'type': btype,
                'message': f"Add '{field}'{hint}",
            })

        # High priority: format errors
        for err in validation['format_errors']:
            recs.append({
                'priority': 'high',
                'type': btype,
                'message': err['message'],
            })

        # Medium priority: structural warnings
        for warn in validation['warnings']:
            recs.append({
                'priority': 'medium',
                'type': btype,
                'message': warn['message'],
            })

        # Low priority: missing recommended fields
        for field in validation['recommended']['missing']:
            recs.append({
                'priority': 'low',
                'type': btype,
                'message': f"Add '{field}' for better search appearance",
            })

        # Low priority: image shape hint
        raw = block.get('raw_json', {})
        if isinstance(raw, dict):
            for r in _check_image_shape_recommendations(raw):
                recs.append({
                    'priority': 'low',
                    'type': btype,
                    'message': r['message'],
                })

    # Page-level recommendations (duplicates, sitelinks search box)
    if page_level:
        recs.extend(page_level)

    # Deduplicate: same (priority, type, message) across blocks
    seen: set = set()
    deduped: List[Dict[str, str]] = []
    for rec in recs:
        key = (rec['priority'], rec['type'], rec['message'])
        if key not in seen:
            seen.add(key)
            deduped.append(rec)

    return deduped


def _detect_duplicate_types(raw_blocks: List[Dict[str, Any]]) -> List[str]:
    """Flag types that appear twice without distinguishing @id."""
    seen: Dict[str, List[Optional[str]]] = {}
    for b in raw_blocks:
        if not isinstance(b, dict) or b.get('_parse_error'):
            continue
        types = _resolve_type(b)
        bid = b.get('@id') if isinstance(b.get('@id'), str) else None
        for t in types:
            seen.setdefault(t, []).append(bid)

    duplicates: List[str] = []
    for t, ids in seen.items():
        if len(ids) < 2:
            continue
        # If all blocks have distinguishing @id, skip
        non_null_ids = [i for i in ids if i]
        if len(non_null_ids) == len(ids) and len(set(non_null_ids)) == len(non_null_ids):
            continue
        duplicates.append(t)
    return duplicates


def _check_website_searchaction(raw_blocks: List[Dict[str, Any]]) -> bool:
    """Return True if a WebSite block with SearchAction potentialAction exists."""
    has_website = False
    has_searchaction = False
    for b in raw_blocks:
        if not isinstance(b, dict) or b.get('_parse_error'):
            continue
        types = _resolve_type(b)
        if 'WebSite' not in types:
            continue
        has_website = True
        pa = b.get('potentialAction')
        if pa is None:
            continue
        pa_list = pa if isinstance(pa, list) else [pa]
        for action in pa_list:
            if not isinstance(action, dict):
                continue
            at = action.get('@type', '')
            atl = at if isinstance(at, list) else [at]
            if 'SearchAction' in atl:
                has_searchaction = True
                break
    # Only emit recommendation if WebSite exists without SearchAction
    return has_website and not has_searchaction


# ── Main ────────────────────────────────────────────────────────────────

def main() -> None:
    try:
        input_data = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        json.dump({'error': 'Invalid JSON input'}, sys.stdout)
        return

    html = input_data.get('html', '')
    if not html:
        json.dump({
            'blocks_found': 0,
            'blocks': [],
            'overall_score': 0,
            'recommendations': [],
            'summary': {
                'total_blocks': 0,
                'valid_blocks': 0,
                'types_found': [],
                'rich_results_eligible': [],
                'rich_results_ineligible': [],
                'duplicate_types': [],
            },
        }, sys.stdout)
        return

    raw_blocks = _extract_jsonld_blocks(html)

    validated_blocks: List[Dict[str, Any]] = []
    all_types: List[str] = []
    eligible_types: List[str] = []
    ineligible_types: List[str] = []

    for data in raw_blocks:
        # Handle parse errors
        if data.get('_parse_error'):
            validated_blocks.append({
                'raw_json': {'_error': 'Invalid JSON-LD', '_raw': data.get('_raw', '')},
                'type': 'Unknown',
                'validation': {
                    'required': {'fields': [], 'present': [], 'missing': []},
                    'recommended': {'fields': [], 'present': [], 'missing': []},
                    'format_errors': [{'field': 'JSON-LD', 'value': '', 'expected': 'Valid JSON', 'message': 'Could not parse JSON-LD block'}],
                    'warnings': [],
                },
                'rich_results': {'eligible': False, 'types': [], 'missing_for_eligibility': []},
                'score': 0,
            })
            continue

        types = _resolve_type(data)
        primary_type = types[0] if types else 'Unknown'
        all_types.extend(types)

        validation = _validate_block(data, primary_type)
        rich_results = _check_rich_results(data, primary_type)
        score = _compute_block_score(validation)

        if rich_results['eligible']:
            eligible_types.extend(types)
        else:
            # Only mark as ineligible if the type has rich results rules
            for t in types:
                if t in RICH_RESULTS_RULES:
                    ineligible_types.append(t)

        validated_blocks.append({
            'raw_json': data,
            'type': primary_type,
            'validation': validation,
            'rich_results': rich_results,
            'score': score,
        })

    # Page-level signals
    duplicate_types = _detect_duplicate_types(raw_blocks)
    page_level_recs: List[Dict[str, str]] = []
    for dt in duplicate_types:
        page_level_recs.append({
            'priority': 'medium',
            'type': dt,
            'message': f"Duplicate '{dt}' block on page without distinguishing '@id'",
        })

    if _check_website_searchaction(raw_blocks):
        page_level_recs.append({
            'priority': 'low',
            'type': 'WebSite',
            'message': "Add 'potentialAction' of type 'SearchAction' to enable sitelinks search box",
        })

    # inLanguage recommendation for content types
    for b in validated_blocks:
        raw = b.get('raw_json', {})
        if not isinstance(raw, dict) or raw.get('_error'):
            continue
        types = _resolve_type(raw)
        if any(t in INLANGUAGE_TYPES for t in types) and not raw.get('inLanguage'):
            page_level_recs.append({
                'priority': 'low',
                'type': b['type'],
                'message': "Add 'inLanguage' (BCP 47 tag, e.g., 'en-US') for better internationalisation",
            })

    recommendations = _generate_recommendations(validated_blocks, page_level_recs)

    valid_blocks = sum(1 for b in validated_blocks if not b['raw_json'].get('_error'))

    # Overall score: average of per-block scores (or 0 when no blocks)
    if validated_blocks:
        overall_score = round(sum(b.get('score', 0) for b in validated_blocks) / len(validated_blocks))
    else:
        overall_score = 0

    result = {
        'blocks_found': len(validated_blocks),
        'blocks': validated_blocks,
        'overall_score': overall_score,
        'recommendations': recommendations,
        'summary': {
            'total_blocks': len(validated_blocks),
            'valid_blocks': valid_blocks,
            'types_found': list(dict.fromkeys(all_types)),
            'rich_results_eligible': list(dict.fromkeys(eligible_types)),
            'rich_results_ineligible': list(dict.fromkeys(ineligible_types)),
            'duplicate_types': duplicate_types,
        },
    }

    json.dump(result, sys.stdout)


if __name__ == '__main__':
    main()
