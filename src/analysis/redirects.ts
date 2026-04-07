/**
 * Redirect chain annotation helpers.
 *
 * Given an origin URL and a redirect chain (each entry being the location hop after the origin),
 * produce per-hop "from → to" pairs with labels identifying HTTP→HTTPS upgrades,
 * www↔apex transitions, and trailing-slash normalization.
 */

export interface RedirectHop {
  index: number;      // 1-based hop number
  from: string;
  to: string;
  labels: string[];
}

/**
 * Turn an origin URL + chain (list of Location URLs in order) into annotated hops.
 * Each hop is (prev → next). The first hop's `from` is the origin URL itself.
 */
export function annotateRedirectChain(origin: string, chain: string[] | undefined): RedirectHop[] {
  if (!chain || chain.length === 0) return [];
  const hops: RedirectHop[] = [];
  let prev = origin;
  for (let i = 0; i < chain.length; i++) {
    const next = chain[i];
    hops.push({
      index: i + 1,
      from: prev,
      to: next,
      labels: detectHopLabels(prev, next),
    });
    prev = next;
  }
  return hops;
}

function detectHopLabels(from: string, to: string): string[] {
  const labels: string[] = [];
  let fromU: URL | null = null;
  let toU: URL | null = null;
  try { fromU = new URL(from); } catch { /* ignore */ }
  try { toU = new URL(to); } catch { /* ignore */ }

  if (fromU && toU) {
    if (fromU.protocol === 'http:' && toU.protocol === 'https:') {
      labels.push('HTTP→HTTPS');
    }
    const fromWww = fromU.hostname.startsWith('www.');
    const toWww = toU.hostname.startsWith('www.');
    if (fromWww && !toWww) labels.push('www → apex');
    if (!fromWww && toWww) labels.push('apex → www');

    const fromPath = fromU.pathname;
    const toPath = toU.pathname;
    if (fromPath !== toPath) {
      const fromTrailing = fromPath.length > 1 && fromPath.endsWith('/');
      const toTrailing = toPath.length > 1 && toPath.endsWith('/');
      if (fromTrailing !== toTrailing && fromPath.replace(/\/+$/, '') === toPath.replace(/\/+$/, '')) {
        labels.push('trailing-slash');
      }
    }
  }
  return labels;
}
