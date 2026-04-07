#!/usr/bin/env node
/**
 * SGNL CLI Entry Point
 * Thin orchestrator — each command lives in its own file under ./commands/
 * Commands are auto-discovered: any file exporting a register*Command function is loaded.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import { killAllChildren } from './utils/process-registry';

// Prevent unhandled EPIPE errors when stdout/stderr is closed early (e.g. piped to head)
process.stdout.on('error', (err: NodeJS.ErrnoException) => { if (err.code === 'EPIPE') process.exit(0); });
process.stderr.on('error', (err: NodeJS.ErrnoException) => { if (err.code === 'EPIPE') process.exit(0); });

// Graceful shutdown: kill tracked child processes before exiting
process.on('SIGINT', () => { killAllChildren(); process.exit(0); });
process.on('SIGTERM', () => { killAllChildren(); process.exit(0); });

// Read version from package.json (single source of truth)
const pkgVersion = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;

const program = new Command();

program
  .name('sgnl')
  .description('SGNL — Signal Intelligence CLI: analyze any URL for performance, SEO, and structure')
  .version(pkgVersion);

// Auto-discover and register all commands from ./commands/
const commandsDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsDir)) {
  if (!file.endsWith('.js')) continue;       // skip non-compiled files
  if (file === 'helpers.js') continue;       // skip shared utilities
  try {
    const mod = require(path.join(commandsDir, file));
    const registerFn = Object.values(mod).find(
      (v): v is (p: Command) => void => typeof v === 'function' && v.name.startsWith('register'),
    );
    if (registerFn) registerFn(program);
  } catch {
    // Skip files that fail to load (e.g. missing optional deps)
  }
}

// Handle unknown commands
program.on('command:*', () => {
  console.error(`Error: Unknown command "${program.args.join(' ')}"\n`);
  printWelcome();
  process.exit(2);
});

function printWelcome(): void {
  console.log('SGNL — Signal Intelligence CLI\n');
  console.log('Commands:');
  console.log('  init              Set up API keys and output path');
  console.log('  analyze <url>     Full analysis: performance, SEO, and structure');
  console.log('  technical <url>   Technical SEO: meta, canonical, OG, security, caching');
  console.log('  content <url>     Content quality: depth, EEAT, freshness, readability');
  console.log('  structure <url>   Page structure: DOM, headings, scripts, images, links');
  console.log('  performance <url> Performance: Core Web Vitals, speed, opportunities');
  console.log('  robots <url>      Robots.txt: rules, sitemaps, crawl access');
  console.log('  schema <url>      Schema.org JSON-LD structured data validation');
  console.log('  explorer crawl <url>  Crawl a site and generate interactive link map');
  console.log('  explorer inspect/links/top-pages/clusters/depth-map/external/unranked');
  console.log('  gsc <subcommand>  Google Search Console: login, logout, status');
  console.log('  headers <sub>     Manage custom HTTP headers: set, list, remove, clear\n');
  console.log('All commands support --output json, --device mobile|desktop, and -H "Name: Value"');
  console.log('Run sgnl init to get started.');
}

// Show welcome screen if no args
if (process.argv.length < 3) {
  printWelcome();
  process.exit(0);
}

program.parse(process.argv);

export { program };
