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

// O_NOFOLLOW on both read and write: a symlink at the allowlist path would
// otherwise redirect host-privileged writes to an attacker-chosen file.
function readAllowlist() {
  let fd;
  try {
    fd = fs.openSync(allowlistPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    if (err.code === 'ELOOP') {
      console.error(`Refusing to follow symlink at allowlist path: ${allowlistPath}`);
      process.exit(1);
    }
    throw err;
  }
  try {
    const st = fs.fstatSync(fd);
    const buf = Buffer.alloc(st.size);
    fs.readSync(fd, buf, 0, st.size, 0);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function appendAllowlist(text) {
  let fd;
  try {
    fd = fs.openSync(
      allowlistPath,
      fs.constants.O_WRONLY |
        fs.constants.O_APPEND |
        fs.constants.O_CREAT |
        fs.constants.O_NOFOLLOW,
      0o644
    );
  } catch (err) {
    if (err.code === 'ELOOP') {
      console.error(`Refusing to follow symlink at allowlist path: ${allowlistPath}`);
      process.exit(1);
    }
    throw err;
  }
  try {
    fs.writeSync(fd, text);
  } finally {
    fs.closeSync(fd);
  }
}

const existing = readAllowlist();
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
appendAllowlist(`${appendSuffix}${added.join('\n')}\n`);
console.log(`Added ${added.length} domain(s) to allowlist: ${added.join(', ')}`);
