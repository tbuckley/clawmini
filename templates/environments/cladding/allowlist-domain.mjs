#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// cwd is guaranteed to sit inside the env's target directory, which is in
// turn inside the workspace. Walk up looking for .cladding/config, stopping
// at the workspace root (the dir containing .clawmini) so we never cross
// into an ancestor project.
function findCladdingConfigDir(startDir) {
  let curr = path.resolve(startDir);
  while (true) {
    const candidate = path.join(curr, '.cladding', 'config');
    if (fs.existsSync(candidate)) return candidate;
    if (fs.existsSync(path.join(curr, '.clawmini'))) return null;
    const parent = path.dirname(curr);
    if (parent === curr) return null;
    curr = parent;
  }
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
  console.error('Could not locate .cladding/config within the workspace.');
  process.exit(1);
}

const allowlistPath = path.join(configDir, 'sandbox_domains.lst');

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

const reload = spawnSync('cladding', ['reload-proxy'], {
  stdio: 'inherit',
  cwd: path.dirname(configDir),
});
if (reload.status !== 0) {
  console.error('Warning: `cladding reload-proxy` exited with code', reload.status);
  process.exit(reload.status ?? 1);
}
