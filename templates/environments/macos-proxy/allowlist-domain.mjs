#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const allowlistPath = path.join(__dirname, 'allowlist.txt');

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
