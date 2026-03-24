#!/usr/bin/env node
/* global process, Buffer */
import { execSync } from 'node:child_process';

const token = process.env.CLAW_API_TOKEN;
if (!token) process.exit(0);

const payloadStr = Buffer.from(token.split('.')[1], 'base64').toString();
const payload = JSON.parse(payloadStr);
const myAgentId = payload.agentId;

try {
  const output = execSync('npx clawmini-lite subagents list --json --pending', { encoding: 'utf-8' });
  const subagents = JSON.parse(output);

  // We are a subagent if we are in the list. Wait, subagents have an ID, but their agentId is `myAgentId`.
  // Wait! A subagent is in the `subagents` list. A main agent is NOT in the list.
  const iAmSubagent = subagents.some(s => s.agentId === myAgentId) || myAgentId !== 'default';

  if (iAmSubagent) {
    // Find our children (subagents where parentId is our agentId)
    const pendingChildren = subagents.filter(s => s.parentId === myAgentId);
    if (pendingChildren.length > 0) {
      const ids = pendingChildren.map(s => s.id).join(', ');
      console.log(JSON.stringify({
        decision: 'deny',
        reason: `You must wait for all subagents to complete with 'clawmini-lite subagents wait <id>'. Pending subagents: ${ids}`
      }));
      process.exit(0);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
} catch (err) {
  // If parsing fails or command fails, just allow
}

console.log(JSON.stringify({ decision: 'allow' }));
