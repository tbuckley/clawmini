#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function findCladdingConfigDir(startDir) {
  let curr = path.resolve(startDir);
  while (curr !== path.parse(curr).root) {
    const candidate = path.join(curr, '.cladding', 'config');
    if (fs.existsSync(candidate)) return candidate;
    curr = path.dirname(curr);
  }
  return null;
}

const domains = process.argv.slice(2).filter((arg) => arg.length > 0);
if (domains.length === 0) {
  console.error('Usage: allowlist-domain <domain> [<domain>...]');
  process.exit(1);
}

const domainPattern = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
for (const domain of domains) {
  if (!domainPattern.test(domain)) {
    console.error(`Invalid domain: ${domain}`);
    process.exit(1);
  }
}

const configDir = findCladdingConfigDir(process.cwd());
if (!configDir) {
  console.error('Could not locate .cladding/config directory from cwd.');
  process.exit(1);
}

const allowlistPath = path.join(configDir, 'sandbox_domains.lst');
let existing = '';
try {
  existing = fs.readFileSync(allowlistPath, 'utf8');
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const existingDomains = new Set(
  existing
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
);

const added = [];
for (const domain of domains) {
  if (!existingDomains.has(domain)) {
    existingDomains.add(domain);
    added.push(domain);
  }
}

if (added.length === 0) {
  console.log('No new domains to add; allowlist already contains all requested domains.');
  process.exit(0);
}

const appendSuffix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
fs.appendFileSync(allowlistPath, `${appendSuffix}${added.join('\n')}\n`);
console.log(`Added ${added.length} domain(s) to allowlist: ${added.join(', ')}`);

const reload = spawnSync('cladding', ['reload-proxy'], {
  stdio: 'inherit',
  cwd: path.dirname(configDir),
});
if (reload.status !== 0) {
  console.error('Warning: `cladding reload-proxy` exited with code', reload.status);
  process.exit(reload.status ?? 1);
}
