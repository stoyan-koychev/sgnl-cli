import { runPythonScriptSafe } from './python';

export interface SchemaFormatError {
  field: string;
  value: string;
  expected: string;
  message: string;
}

export interface SchemaWarning {
  field: string;
  message: string;
}

export interface SchemaBlockValidation {
  required: {
    fields: string[];
    present: string[];
    missing: string[];
  };
  recommended: {
    fields: string[];
    present: string[];
    missing: string[];
  };
  format_errors: SchemaFormatError[];
  warnings: SchemaWarning[];
}

export interface SchemaRichResults {
  eligible: boolean;
  types: string[];
  missing_for_eligibility: string[];
}

export interface SchemaBlock {
  raw_json: Record<string, unknown>;
  type: string;
  validation: SchemaBlockValidation;
  rich_results: SchemaRichResults;
  score: number;
}

export interface SchemaRecommendation {
  priority: 'high' | 'medium' | 'low';
  type: string;
  message: string;
}

export interface SchemaSummary {
  total_blocks: number;
  valid_blocks: number;
  types_found: string[];
  rich_results_eligible: string[];
  rich_results_ineligible: string[];
  duplicate_types?: string[];
}

export interface SchemaReport {
  blocks_found: number;
  blocks: SchemaBlock[];
  overall_score: number;
  recommendations: SchemaRecommendation[];
  summary: SchemaSummary;
}

/**
 * Run the schema_validator.py script to validate JSON-LD markup in HTML.
 * @param html - Raw HTML string
 * @returns SchemaReport or null if validation failed
 */
export async function runSchemaValidation(html: string, timeout?: number): Promise<SchemaReport | null> {
  const result = await runPythonScriptSafe('schema_validator.py', JSON.stringify({ html }), timeout);
  if (!result.success || !result.data) return null;
  return result.data as unknown as SchemaReport;
}
