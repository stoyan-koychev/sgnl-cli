#!/usr/bin/env python3
"""
graph_analysis.py <crawl.jsonl> <metadata.json> <compact.json>

Reads a streaming JSONL crawl file produced by sgnl explorer, runs PageRank +
community detection, and writes a compact.json matching CompactLinkMapData v3.
"""

import json
import sys
import os
from urllib.parse import urlparse
from collections import deque

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) != 4:
        print(f"Usage: {sys.argv[0]} <crawl.jsonl> <metadata.json> <compact.json>", file=sys.stderr)
        sys.exit(1)

    crawl_path, meta_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]

    # -----------------------------------------------------------------------
    # Pass 1: stream JSONL, build in-memory tables
    # -----------------------------------------------------------------------
    page_data   = {}   # url -> {title, h1, status, metaRobots, isIndexable, crawlDepth, canonical}
    raw_links   = {}   # url -> [{target, follow, type}]
    in_degree   = {}   # url -> int  (internal inlinks only)
    out_internal= {}   # url -> int
    out_external= {}   # url -> int
    ext_domains  = {}  # domain -> count
    ext_first_url= {}  # domain -> first representative URL

    total = 0
    print("  Reading crawl data…", file=sys.stderr)
    with open(crawl_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError as e:
                print(f"  Warning: skipping invalid JSON line: {e}", file=sys.stderr)
                continue

            url = rec['url']
            page_data[url] = {
                'title':      rec.get('title', ''),
                'h1':         rec.get('h1', ''),
                'status':     rec.get('status', 0),
                'metaRobots': rec.get('metaRobots', ''),
                'isIndexable':rec.get('isIndexable', False),
                'crawlDepth': rec.get('crawlDepth', 0),
                'canonical':  rec.get('canonical'),
            }

            links = rec.get('links', [])
            raw_links[url] = links

            int_out = 0
            ext_out = 0
            for lnk in links:
                tgt  = lnk.get('target', '')
                ltyp = lnk.get('type', '')
                if ltyp == 'internal':
                    int_out += 1
                    in_degree[tgt] = in_degree.get(tgt, 0) + 1
                elif ltyp == 'external':
                    ext_out += 1
                    try:
                        domain = urlparse(tgt).hostname or ''
                        if domain:
                            ext_domains[domain] = ext_domains.get(domain, 0) + 1
                            if domain not in ext_first_url:
                                ext_first_url[domain] = tgt
                    except Exception:
                        pass

            out_internal[url] = int_out
            out_external[url] = ext_out
            total += 1

    print(f"  Loaded {total} pages.", file=sys.stderr)

    # -----------------------------------------------------------------------
    # Load metadata
    # -----------------------------------------------------------------------
    with open(meta_path, 'r', encoding='utf-8') as f:
        meta = json.load(f)

    base_url         = meta.get('baseUrl', '')
    crawled_at       = meta.get('crawledAt', '')
    sitemap_urls     = set(meta.get('sitemapUrls', []))
    errors_dict      = meta.get('errors', {})        # url -> error message
    uncrawled_reasons= meta.get('uncrawledReasons', {})  # url -> reason string

    base_norm = base_url.rstrip('/')
    try:
        base_origin = urlparse(base_url).scheme + '://' + urlparse(base_url).netloc
    except Exception:
        base_origin = ''

    # All crawled URLs (successful + error)
    all_crawled = set(page_data.keys()) | set(errors_dict.keys())

    # -----------------------------------------------------------------------
    # PageRank (exact port of pagerank.ts)
    # -----------------------------------------------------------------------
    internal_urls = list(page_data.keys())
    N = len(internal_urls)

    in_links = {}   # url -> [src_url, ...]
    for src, links in raw_links.items():
        for lnk in links:
            if lnk.get('type') == 'internal':
                tgt = lnk['target']
                if tgt not in in_links:
                    in_links[tgt] = []
                in_links[tgt].append(src)

    if N > 0:
        pr = {u: 1.0 / N for u in internal_urls}
        for _ in range(50):
            next_pr = {}
            for u in internal_urls:
                rank = (1 - 0.85) / N
                for src in in_links.get(u, []):
                    rank += 0.85 * pr.get(src, 0) / max(1, out_internal.get(src, 0))
                next_pr[u] = rank
            pr = next_pr
        max_pr = max(pr.values(), default=1e-9)
        if max_pr < 1e-9:
            max_pr = 1e-9
        pr = {u: round(v / max_pr * 10000) / 10000 for u, v in pr.items()}
    else:
        pr = {}

    # -----------------------------------------------------------------------
    # External domain nodes
    # -----------------------------------------------------------------------
    top_external_domains = sorted(ext_domains.items(), key=lambda x: -x[1])[:10]

    # ext node ids: "ext:{domain}"
    ext_node_ids = {f"ext:{d}": d for d in ext_domains}

    # -----------------------------------------------------------------------
    # Node classification (exact port of data-processor.ts lines 46-84)
    # -----------------------------------------------------------------------
    TYPE_MAP = {'home': 0, 'normal': 1, 'orphan': 2, 'error_4xx': 3, 'error_5xx': 5, 'external': 4}

    nodes = []   # list of node dicts

    for url in all_crawled:
        page = page_data.get(url)
        status = page['status'] if page else 0
        inlinks = in_degree.get(url, 0)
        crawl_depth = page['crawlDepth'] if page else 0

        url_norm = url.rstrip('/')
        is_home    = url_norm == base_norm or url == base_url
        is_error5  = status >= 500
        is_error4  = (400 <= status < 500) or (url in errors_dict and not page and status < 500)
        is_orphan  = not is_home and inlinks == 0 and page is not None

        if is_home:         node_type = 'home'
        elif is_error5:     node_type = 'error_5xx'
        elif is_error4:     node_type = 'error_4xx'
        elif is_orphan:     node_type = 'orphan'
        else:               node_type = 'normal'

        raw_title = (page['title'] if page else '') or ''
        try:
            short_path = urlparse(url).path or '/'
        except Exception:
            short_path = '/'
        label = (raw_title or short_path)[:80]

        int_out = out_internal.get(url, 0)
        ext_out = out_external.get(url, 0)
        page_rank = pr.get(url, 0)

        is_dead_end       = int_out == 0 and node_type not in ('error_4xx', 'error_5xx')
        is_deep_page      = crawl_depth > 3
        too_many_external = ext_out > 5
        in_sitemap        = True if not sitemap_urls else url in sitemap_urls
        indexable         = (page['isIndexable'] if page else False)

        flags = (
            (1  if is_dead_end       else 0) |
            (2  if is_deep_page      else 0) |
            (4  if too_many_external else 0) |
            (8  if in_sitemap        else 0) |
            (16 if indexable         else 0)
        )

        nodes.append({
            'id':           url,
            'label':        label,
            'type':         node_type,
            'status':       status,
            'inlinks':      inlinks,
            'outlinks':     int_out,
            'outExternal':  ext_out,
            'crawlDepth':   crawl_depth,
            'linkDepth':    0,   # filled in BFS below
            'pageRank':     page_rank,
            'isDeadEnd':    is_dead_end,
            'isDeepPage':   is_deep_page,
            'tooManyExternal': too_many_external,
            'inSitemap':    in_sitemap,
            'indexable':    indexable,
            'canonical':    (page['canonical'] if page else None),
            'extUrl':       None,
            'h1':           (page['h1'] if page else ''),
            'metaRobots':   (page['metaRobots'] if page else ''),
            'flags':        flags,
        })

    # External domain nodes
    seen_ext_ids = set()
    for node_id, domain in ext_node_ids.items():
        if node_id in seen_ext_ids:
            continue
        seen_ext_ids.add(node_id)
        nodes.append({
            'id':           node_id,
            'label':        domain,
            'type':         'external',
            'status':       0,
            'inlinks':      ext_domains.get(domain, 0),
            'outlinks':     0,
            'outExternal':  0,
            'crawlDepth':   0,
            'linkDepth':    0,
            'pageRank':     0,
            'isDeadEnd':    False,
            'isDeepPage':   False,
            'tooManyExternal': False,
            'inSitemap':    False,
            'indexable':    False,
            'canonical':    None,
            'extUrl':       ext_first_url.get(domain),
            'h1':           '',
            'metaRobots':   '',
            'flags':        0,
        })

    # -----------------------------------------------------------------------
    # Link depth BFS (exact port of data-processor.ts lines 87-104)
    # -----------------------------------------------------------------------
    link_depth_map = {}
    bfs_q = deque()
    bfs_visited = set()
    bfs_q.append((base_url, 0))
    bfs_visited.add(base_url)
    link_depth_map[base_url] = 0

    while bfs_q:
        cur_url, d = bfs_q.popleft()
        for lnk in raw_links.get(cur_url, []):
            if lnk.get('type') == 'internal':
                tgt = lnk['target']
                if tgt not in bfs_visited:
                    bfs_visited.add(tgt)
                    link_depth_map[tgt] = d + 1
                    bfs_q.append((tgt, d + 1))

    # Back-fill linkDepth
    for n in nodes:
        n['linkDepth'] = link_depth_map.get(n['id'], n['crawlDepth'])

    # -----------------------------------------------------------------------
    # Build edges (deduplicated internal + external domain edges)
    # -----------------------------------------------------------------------
    edge_set = set()
    edges = []

    for src_url, links in raw_links.items():
        for lnk in links:
            tgt  = lnk.get('target', '')
            ltyp = lnk.get('type', '')
            follow = 1 if lnk.get('follow', True) else 0

            if ltyp == 'internal':
                key = f"{src_url}\u2192{tgt}"
                if key not in edge_set and tgt in all_crawled:
                    edge_set.add(key)
                    edges.append((src_url, tgt, follow))
            elif ltyp == 'external':
                try:
                    domain = urlparse(tgt).hostname or ''
                except Exception:
                    continue
                if not domain:
                    continue
                ext_id = f"ext:{domain}"
                key = f"{src_url}\u2192{ext_id}"
                if key not in edge_set:
                    edge_set.add(key)
                    edges.append((src_url, ext_id, follow))

    # -----------------------------------------------------------------------
    # Community detection (exact port of community-detection.ts)
    # -----------------------------------------------------------------------
    seg_map = {}   # segment -> community_id
    next_id = [0]
    communities = {}  # node_id -> community_id

    for n in nodes:
        nid  = n['id']
        ntyp = n['type']
        if ntyp == 'external':
            seg = 'external'
        else:
            try:
                parts = [p for p in urlparse(nid).path.split('/') if p]
                seg = parts[0] if parts else 'root'
            except Exception:
                seg = 'other'
        if seg not in seg_map:
            seg_map[seg] = next_id[0]
            next_id[0] += 1
        communities[nid] = seg_map[seg]

    # -----------------------------------------------------------------------
    # Meta lists (exact port of data-processor.ts lines 163-171)
    # -----------------------------------------------------------------------
    orphans              = [n['id'] for n in nodes if n['type'] == 'orphan']
    dead_ends            = [n['id'] for n in nodes if n['isDeadEnd'] and n['type'] != 'external']
    deep_pages           = [n['id'] for n in nodes if n['isDeepPage']]
    too_many_ext_list    = [n['id'] for n in nodes if n['tooManyExternal']]
    not_in_sitemap       = [n['id'] for n in nodes
                            if n['type'] not in ('home', 'error_4xx', 'error_5xx', 'external') and not n['inSitemap']]
    errors_4xx           = [n['id'] for n in nodes if n['type'] == 'error_4xx']
    errors_5xx           = [n['id'] for n in nodes if n['type'] == 'error_5xx']
    uncrawled_sitemap    = [u for u in sitemap_urls if u not in all_crawled]

    # -----------------------------------------------------------------------
    # URL index table (exact port of data-processor.ts lines 177-185)
    # -----------------------------------------------------------------------
    url_set = set()
    for n in nodes:
        url_set.add(n['id'])
        if n['canonical']:
            url_set.add(n['canonical'])
        if n['extUrl']:
            url_set.add(n['extUrl'])
    for u in uncrawled_sitemap:
        url_set.add(u)

    urls = list(url_set)
    url_to_idx = {u: i for i, u in enumerate(urls)}

    # -----------------------------------------------------------------------
    # Assemble compact output
    # -----------------------------------------------------------------------
    compact = {
        'v': 3,
        'urls': urls,
        'meta': {
            'baseUrl':            base_url,
            'crawledAt':          crawled_at,
            'orphans':            [url_to_idx[u] for u in orphans if u in url_to_idx],
            'notInSitemap':       [url_to_idx[u] for u in not_in_sitemap if u in url_to_idx],
            'uncrawledSitemap':   [url_to_idx[u] for u in uncrawled_sitemap if u in url_to_idx],
            'deadEnds':           [url_to_idx[u] for u in dead_ends if u in url_to_idx],
            'deepPages':          [url_to_idx[u] for u in deep_pages if u in url_to_idx],
            'tooManyExternal':    [url_to_idx[u] for u in too_many_ext_list if u in url_to_idx],
            'errors4xx':          [url_to_idx[u] for u in errors_4xx if u in url_to_idx],
            'errors5xx':          [url_to_idx[u] for u in errors_5xx if u in url_to_idx],
            'topExternalDomains': top_external_domains,
            'uncrawledReasons':   uncrawled_reasons,
        },
        'nodes': {
            'idx':         [url_to_idx[n['id']] for n in nodes if n['id'] in url_to_idx],
            'label':       [n['label'] for n in nodes if n['id'] in url_to_idx],
            'type':        [TYPE_MAP.get(n['type'], 1) for n in nodes if n['id'] in url_to_idx],
            'status':      [n['status'] for n in nodes if n['id'] in url_to_idx],
            'inlinks':     [n['inlinks'] for n in nodes if n['id'] in url_to_idx],
            'outlinks':    [n['outlinks'] for n in nodes if n['id'] in url_to_idx],
            'outExternal': [n['outExternal'] for n in nodes if n['id'] in url_to_idx],
            'crawlDepth':  [n['crawlDepth'] for n in nodes if n['id'] in url_to_idx],
            'linkDepth':   [n['linkDepth'] for n in nodes if n['id'] in url_to_idx],
            'pageRank':    [n['pageRank'] for n in nodes if n['id'] in url_to_idx],
            'flags':       [n['flags'] for n in nodes if n['id'] in url_to_idx],
            'canonical':   [
                (url_to_idx.get(n['canonical']) if n['canonical'] else None)
                for n in nodes if n['id'] in url_to_idx
            ],
            'extUrl':      [
                (url_to_idx.get(n['extUrl']) if n['extUrl'] else None)
                for n in nodes if n['id'] in url_to_idx
            ],
            'h1':          [n['h1'] for n in nodes if n['id'] in url_to_idx],
            'metaRobots':  [n['metaRobots'] for n in nodes if n['id'] in url_to_idx],
        },
        'edges': [
            [url_to_idx[s], url_to_idx[t], f]
            for s, t, f in edges
            if s in url_to_idx and t in url_to_idx
        ],
        'communities': [communities.get(n['id'], 0) for n in nodes if n['id'] in url_to_idx],
        'segMap':      list(seg_map.items()),
    }

    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(compact, f, separators=(',', ':'))

    print(f"  compact.json written ({len(nodes)} nodes, {len(edges)} edges).", file=sys.stderr)


if __name__ == '__main__':
    main()
