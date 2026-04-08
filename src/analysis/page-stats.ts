import { runPythonScriptSafe } from './python';
import type { PageData } from '../explorer/crawler';

export interface PageStats {
  domElements?: number;
  domDepth?: number;
  h2?: number;
  h3?: number;
  paragraphs?: number;
  avgParaLen?: number;
  images?: number;
  imagesNoAlt?: number;
  flesch?: number;
  schemaTypes?: string[];
  hasOG?: boolean;
  metaDescLen?: number;
}

const CONCURRENCY = 5;

export async function runPageStats(
  pages: Map<string, PageData>,
  quiet = false
): Promise<Map<string, PageStats>> {
  const results = new Map<string, PageStats>();
  const entries = [...pages.entries()].filter(([, p]) => !!p.rawHtml);

  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY);
    if (!quiet) process.stderr.write(`\r  Analysing pages ${i + 1}–${Math.min(i + CONCURRENCY, entries.length)} / ${entries.length}...`);
    await Promise.all(batch.map(async ([url, page]) => {
      try {
        const html = page.rawHtml!;
        const splitRes = await runPythonScriptSafe('split.py', html, 30000, url);
        if (!splitRes.success) return;
        const { markdown, skeleton } = splitRes.data as { markdown: string; skeleton: string };

        const [xray, onpage, techseo] = await Promise.allSettled([
          runPythonScriptSafe('xray.py', skeleton),
          runPythonScriptSafe('onpage.py', JSON.stringify({ markdown, html, headers: {} })),
          runPythonScriptSafe('technical_seo.py', JSON.stringify({ html, headers: {} })),
        ]);

        const stats: PageStats = {};
        if (xray.status === 'fulfilled' && xray.value.success) {
          const d = xray.value.data as Record<string, any>;
          stats.domElements = d.dom?.total_elements;
          stats.domDepth    = d.dom?.depth_max;
          stats.h2          = d.structure?.h2_count;
          stats.h3          = d.structure?.h3_count;
        }
        if (onpage.status === 'fulfilled' && onpage.value.success) {
          const d = onpage.value.data as Record<string, any>;
          stats.paragraphs  = d.content?.paragraph_count;
          stats.avgParaLen  = d.content?.avg_paragraph_length;
          stats.images      = d.images?.total;
          stats.imagesNoAlt = d.images?.missing_alt;
          stats.flesch      = d.readability?.flesch_reading_ease;
        }
        if (techseo.status === 'fulfilled' && techseo.value.success) {
          const d = techseo.value.data as Record<string, any>;
          stats.schemaTypes = d.schema?.types;
          stats.hasOG       = !!(d.open_graph?.title && d.open_graph?.description);
          stats.metaDescLen = d.meta?.description?.length;
        }
        results.set(url, stats);
      } catch { /* skip page on error */ }
    }));
  }
  if (!quiet) process.stderr.write('\n');
  return results;
}
