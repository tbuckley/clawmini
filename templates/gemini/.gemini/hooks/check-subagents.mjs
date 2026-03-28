#!/usr/bin/env node
/* global process */
import { execSync } from 'node:child_process';


try {
  const output = execSync('clawmini-lite.js subagents list --json --blocking', { encoding: 'utf-8' });
  const subagents = JSON.parse(output);

  if (subagents.length > 0) {
    const ids = subagents.map(s => s.id).join(', ');
    console.log(JSON.stringify({
      decision: 'deny',
      reason: `You must wait for all subagents to complete with 'clawmini-lite subagents wait <id>'. Pending subagents: ${ids}`
    }));
    process.exit(0);
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
} catch (err) {
  // If parsing fails or command fails, just allow
}

console.log(JSON.stringify({ decision: 'allow' }));
