/**
 * Envelope-parity test for `sgnl schema <url> --output json`.
 *
 * The schema command now emits `{ request, schema }` matching technical /
 * structure / robots / performance. We stub `safeFetch` + `runSchemaValidation`
 * and drive the command programmatically through commander to avoid subprocess
 * networking (sandbox environments block 127.0.0.1 subprocesses).
 */

import { Command } from 'commander';

jest.mock('../../src/analysis/fetch', () => ({
  safeFetch: jest.fn(),
}));
jest.mock('../../src/analysis/schema', () => ({
  runSchemaValidation: jest.fn(),
}));

import { safeFetch } from '../../src/analysis/fetch';
import { runSchemaValidation, SchemaReport } from '../../src/analysis/schema';
import { registerSchemaCommand } from '../../src/commands/schema';

const mockSafeFetch = safeFetch as jest.MockedFunction<typeof safeFetch>;
const mockRunSchema = runSchemaValidation as jest.MockedFunction<typeof runSchemaValidation>;

function makeReport(): SchemaReport {
  return {
    blocks_found: 1,
    blocks: [
      {
        raw_json: { '@context': 'https://schema.org', '@type': 'Organization', name: 'Acme', url: 'https://acme.example' },
        type: 'Organization',
        validation: {
          required: { fields: ['name', 'url'], present: ['name', 'url'], missing: [] },
          recommended: { fields: ['logo'], present: [], missing: ['logo'] },
          format_errors: [],
          warnings: [],
        },
        rich_results: { eligible: false, types: [], missing_for_eligibility: [] },
        score: 95,
      },
    ],
    overall_score: 95,
    recommendations: [],
    summary: {
      total_blocks: 1,
      valid_blocks: 1,
      types_found: ['Organization'],
      rich_results_eligible: [],
      rich_results_ineligible: [],
    },
  };
}

describe('sgnl schema — { request, schema } envelope', () => {
  let stdoutWriteSpy: jest.SpiedFunction<typeof process.stdout.write>;
  let exitSpy: jest.SpiedFunction<typeof process.exit>;
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>;
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;
  let captured: string;

  beforeEach(() => {
    captured = '';
    stdoutWriteSpy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk: any, _enc?: any, cb?: any) => {
      captured += typeof chunk === 'string' ? chunk : chunk.toString();
      if (typeof _enc === 'function') _enc();
      else if (typeof cb === 'function') cb();
      return true;
    });
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(((_code?: number) => undefined) as any);
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
    exitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('emits { request, schema } when --output json', async () => {
    mockSafeFetch.mockResolvedValue({
      status: 200,
      html: '<html></html>',
      headers: { 'content-type': 'text/html; charset=utf-8', 'content-length': '42' },
      ttfb_ms: 123,
      redirect_chain: [],
      error: null,
    });
    mockRunSchema.mockResolvedValue(makeReport());

    const program = new Command();
    program.exitOverride();
    registerSchemaCommand(program);

    await program.parseAsync([
      'node',
      'sgnl',
      'schema',
      'https://example.com',
      '--output',
      'json',
    ]);

    // Wait a tick for flush
    await new Promise((r) => setImmediate(r));

    const jsonStart = captured.indexOf('{');
    expect(jsonStart).toBeGreaterThanOrEqual(0);
    const parsed = JSON.parse(captured.slice(jsonStart));

    expect(parsed).toHaveProperty('request');
    expect(parsed).toHaveProperty('schema');
    expect(parsed.request.url).toBe('https://example.com');
    expect(parsed.request.status).toBe(200);
    expect(parsed.request.ttfb_ms).toBe(123);
    expect(parsed.request.content_type).toBe('text/html; charset=utf-8');
    expect(parsed.request.content_length).toBe(42);
    expect(parsed.request.device).toBe('mobile');
    expect(parsed.schema.blocks_found).toBe(1);
    expect(parsed.schema.blocks[0].type).toBe('Organization');
    expect(parsed.schema.overall_score).toBe(95);
    expect(parsed.schema.blocks[0].score).toBe(95);
  });

  it('passes --device desktop into request context', async () => {
    mockSafeFetch.mockResolvedValue({
      status: 200,
      html: '<html></html>',
      headers: {},
      ttfb_ms: 10,
      redirect_chain: [],
      error: null,
    });
    mockRunSchema.mockResolvedValue(makeReport());

    const program = new Command();
    program.exitOverride();
    registerSchemaCommand(program);

    await program.parseAsync([
      'node',
      'sgnl',
      'schema',
      'https://example.com',
      '--output',
      'json',
      '--device',
      'desktop',
    ]);

    await new Promise((r) => setImmediate(r));

    const parsed = JSON.parse(captured.slice(captured.indexOf('{')));
    expect(parsed.request.device).toBe('desktop');
  });
});
