import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TestEnvironment } from '../_helpers/test-environment.js';

// Ticket 8: `clawmini init` exports the new `clawmini-delegations` skill, and
// the existing `clawmini-subagents` / `clawmini-requests` skill manifests
// were rewritten to point at the unified `delegations` group + `--delivery`
// flag (and away from the now-removed `--async` boolean and the dropped
// `subagents wait|list|delete` subcommands).

describe('E2E Skills exported by init (clawmini-delegations + manifest content)', () => {
  let env: TestEnvironment;
  let agentSkillsDir: string;

  beforeAll(async () => {
    env = new TestEnvironment('e2e-tmp-skills-delegations');
    await env.setup();
    await env.runCli(['init', '--agent', 'test-agent']);
    agentSkillsDir = path.join(env.e2eDir, 'test-agent', '.agents', 'skills');
  }, 30000);

  afterAll(() => env.teardown(), 30000);

  it('exports clawmini-delegations skill into the agent skills dir', () => {
    const delegationsSkillPath = path.join(agentSkillsDir, 'clawmini-delegations', 'SKILL.md');
    expect(fs.existsSync(delegationsSkillPath)).toBe(true);

    const body = fs.readFileSync(delegationsSkillPath, 'utf-8');
    // Mental model + idiom must be documented.
    expect(body).toContain('delegations');
    expect(body).toContain('--delivery');
    expect(body).toMatch(/notify-when|--subscribe/);
    // Cross-links to sibling skills.
    expect(body).toContain('clawmini-requests');
    expect(body).toContain('clawmini-subagents');
  });

  it('clawmini-subagents/SKILL.md mentions --delivery and the delegations group, and no longer mentions --async / wait|list|delete subcommands', () => {
    const subagentsSkillPath = path.join(agentSkillsDir, 'clawmini-subagents', 'SKILL.md');
    expect(fs.existsSync(subagentsSkillPath)).toBe(true);

    const body = fs.readFileSync(subagentsSkillPath, 'utf-8');
    // New surface.
    expect(body).toContain('--delivery');
    expect(body).toContain('delegations');
    // The deprecated `--async` flag is gone as a primary documented flag.
    // (We allow the substring inside an explanatory "no longer --async"
    // note, but the template removes it entirely — match the absence.)
    expect(body).not.toMatch(/`--async`/);
    // Subcommand sections we replaced with pointers to `delegations`.
    expect(body).not.toMatch(/^### Waiting for a Subagent/m);
    expect(body).not.toMatch(/^### Listing Subagents/m);
    expect(body).not.toMatch(/^### Deleting a Subagent/m);
    // Approval-gating callout for spawn and send.
    expect(body.toLowerCase()).toContain('approval');
  });

  it('clawmini-requests/SKILL.md mentions --delivery and points at delegations wait/show', () => {
    const requestsSkillPath = path.join(agentSkillsDir, 'clawmini-requests', 'SKILL.md');
    expect(fs.existsSync(requestsSkillPath)).toBe(true);

    const body = fs.readFileSync(requestsSkillPath, 'utf-8');
    expect(body).toContain('--delivery');
    expect(body).toContain('delegations wait');
    expect(body).toContain('delegations show');
  });
});
