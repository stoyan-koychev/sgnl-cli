/**
 * SGNL: Signal Intelligence CLI
 * Performance, SEO, and structure analysis for any URL.
 *
 * @example
 * import { safeFetch, buildReport, mergeAnalysis } from 'sgnl';
 */

// Core HTTP fetch
export { safeFetch } from './analysis/fetch';
export type { FetchOptions, FetchResult } from './analysis/fetch';

// PSI (PageSpeed Insights)
export { callPSI } from './analysis/psi';
export type { PSIResult, Opportunity, FieldData, LabData } from './analysis/psi';

// Analysis interfaces
export type {
  AnalysisData,
  DOMAnalysis,
  TechnicalSEO,
  OnPageSEO,
} from './analysis/scoring';

// Merger
export { mergeAnalysis } from './analysis/merger';
export type { AnalysisReport, PythonAnalysis } from './analysis/merger';

// Orchestrator (full pipeline)
export { buildReport, buildReportStream } from './analysis/orchestrator';
export type { BuildReportOptions } from './analysis/orchestrator';

// Config types (for consumers that inject per-request config)
export type { ResolvedConfig, GSCTokens } from './config';
export { resolveConfig } from './config';

// Explorer (compact wire format + query helpers)
export type { CompactLinkMapData, D3Node, D3Edge } from './explorer/types';
export type { LoadedRun, DecodedNode, DecodedEdge } from './explorer/query';
export { findLatestRun, loadRun } from './explorer/query';

// Explorer crawler + data processor (for programmatic use)
export { Explorer } from './explorer/crawler';
export type { ExplorerOptions, ExplorerResult } from './explorer/crawler';
export { buildCompactData } from './explorer/data-processor';
