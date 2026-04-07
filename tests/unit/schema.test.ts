import { runSchemaValidation } from '../../src/analysis/schema';
import { runPythonScriptSafe } from '../../src/analysis/python';

jest.mock('../../src/analysis/python');
const mockRunPython = runPythonScriptSafe as jest.MockedFunction<typeof runPythonScriptSafe>;

describe('runSchemaValidation', () => {
  afterEach(() => jest.resetAllMocks());

  it('returns SchemaReport on success', async () => {
    const mockReport = {
      blocks_found: 1,
      blocks: [{
        raw_json: { '@type': 'Article', headline: 'Test' },
        type: 'Article',
        validation: {
          required: { fields: ['headline'], present: ['headline'], missing: [] },
          recommended: { fields: [], present: [], missing: [] },
          format_errors: [],
          warnings: [],
        },
        rich_results: { eligible: false, types: [], missing_for_eligibility: [] },
      }],
      recommendations: [],
      summary: {
        total_blocks: 1,
        valid_blocks: 1,
        types_found: ['Article'],
        rich_results_eligible: [],
        rich_results_ineligible: [],
      },
    };

    mockRunPython.mockResolvedValue({ success: true, data: mockReport });

    const result = await runSchemaValidation('<html></html>');
    expect(result).not.toBeNull();
    expect(result!.blocks_found).toBe(1);
    expect(result!.blocks[0].type).toBe('Article');

    expect(mockRunPython).toHaveBeenCalledWith(
      'schema_validator.py',
      JSON.stringify({ html: '<html></html>' }),
      undefined,
    );
  });

  it('returns null on Python failure', async () => {
    mockRunPython.mockResolvedValue({ success: false, error: 'Python crashed' });

    const result = await runSchemaValidation('<html></html>');
    expect(result).toBeNull();
  });

  it('returns null when data is undefined', async () => {
    mockRunPython.mockResolvedValue({ success: true });

    const result = await runSchemaValidation('<html></html>');
    expect(result).toBeNull();
  });
});
