import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';

const GSCConfigSchema = z.object({
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  properties: z.array(z.string()).optional(),
});

const SgnlConfigSchema = z.object({
  psiKey: z.string().optional(),
  runsPath: z.string().optional(),
  gsc: GSCConfigSchema.optional(),
  headers: z.record(z.string(), z.string()).optional(),
  domainHeaders: z.record(z.string(), z.record(z.string(), z.string())).optional(),
}).passthrough(); // Allow forward-compatible unknown keys

export type GSCConfig = z.infer<typeof GSCConfigSchema>;
export type SgnlConfig = z.infer<typeof SgnlConfigSchema>;

export function getSgnlDir(): string {
  return path.join(os.homedir(), '.sgnl');
}

export function getConfigPath(): string {
  return path.join(getSgnlDir(), 'config.json');
}

export function getGSCTokenPath(): string {
  return path.join(getSgnlDir(), 'gsc-tokens.json');
}

let _cachedConfig: SgnlConfig | null = null;
let _cachedMtime: number | null = null;

export function loadConfig(): SgnlConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return {};
  try {
    // Return cached config if file hasn't changed
    const mtime = fs.statSync(configPath).mtimeMs;
    if (_cachedConfig && _cachedMtime === mtime) return _cachedConfig;

    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const result = SgnlConfigSchema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
      console.error(`Warning: Invalid config at ${configPath}:\n${issues}\nUsing defaults.`);
      return {};
    }
    _cachedConfig = result.data;
    _cachedMtime = mtime;
    return result.data;
  } catch {
    return {};
  }
}

export function saveConfig(config: SgnlConfig): void {
  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  try { fs.chmodSync(configPath, 0o600); } catch { /* Windows or restricted fs */ }
}

// ---------------------------------------------------------------------------
// Programmatic config injection (library API)
// ---------------------------------------------------------------------------

export interface GSCTokens {
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type?: string;
  scope?: string;
}

export interface ResolvedConfig {
  psiKey?: string;
  pythonPath?: string;
  runsPath?: string;
  headers?: Record<string, string>;
  domainHeaders?: Record<string, Record<string, string>>;
  gsc?: {
    clientId?: string;
    clientSecret?: string;
    tokens?: GSCTokens;
    properties?: string[];
  };
}

/**
 * Resolve config from injection + file + env. Precedence: override > env > file.
 * Library consumers pass `override` to get per-request config.
 * The CLI calls this with no args to get the classic file+env behavior.
 */
export function resolveConfig(override?: Partial<ResolvedConfig>): ResolvedConfig {
  const file = loadConfig();
  return {
    psiKey: override?.psiKey ?? process.env.SGNL_PSI_KEY ?? file.psiKey,
    pythonPath: override?.pythonPath,
    runsPath: override?.runsPath ?? file.runsPath,
    headers: { ...((file.headers ?? {}) as Record<string, string>), ...(override?.headers ?? {}) },
    domainHeaders: { ...((file.domainHeaders ?? {}) as Record<string, Record<string, string>>), ...(override?.domainHeaders ?? {}) },
    gsc: {
      clientId: override?.gsc?.clientId ?? file.gsc?.clientId,
      clientSecret: override?.gsc?.clientSecret ?? file.gsc?.clientSecret,
      tokens: override?.gsc?.tokens,
      properties: override?.gsc?.properties ?? file.gsc?.properties,
    },
  };
}
