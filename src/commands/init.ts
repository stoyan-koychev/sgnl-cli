/**
 * SGNL CLI — init command
 */

import * as readline from 'readline';
import * as os from 'os';
import * as path from 'path';
import { Command } from 'commander';
import { loadConfig, saveConfig, getConfigPath } from '../config';

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Set up API keys and output path')
    .action(async () => {
      const existing = loadConfig();
      const defaultRunsPath = path.join(os.homedir(), '.sgnl', 'runs');

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ask = (question: string): Promise<string> =>
        new Promise(resolve => rl.question(question, resolve));

      console.log('\nWelcome to SGNL setup!\n');

      const psiKeyInput = await ask(
        existing.psiKey
          ? `? PSI API key [current: ${existing.psiKey.slice(0, 8)}...] (leave blank to keep): `
          : '? PSI API key: '
      );
      const runsPathInput = await ask(
        `? Path to save run reports [${existing.runsPath ?? defaultRunsPath}]: `
      );

      rl.close();

      const psiKey = psiKeyInput.trim() || existing.psiKey;
      const runsPath = runsPathInput.trim() || existing.runsPath || defaultRunsPath;

      saveConfig({ psiKey, runsPath });

      console.log(`\n✓ Config saved to ${getConfigPath()}\n`);
      console.log("You're all set. Try:");
      console.log('  sgnl analyze https://example.com\n');
      process.exit(0);
    });
}
