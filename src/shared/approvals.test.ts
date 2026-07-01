import { describe, it, expect } from 'vitest';
import {
  BUILTIN_SUBAGENT_RULES,
  evaluateSubagentApproval,
  resolveSubagentApproval,
  type SubagentRule,
} from './approvals.js';

describe('evaluateSubagentApproval', () => {
  it('returns null when no rule matches', () => {
    const rules: SubagentRule[] = [{ from: 'agents/a', to: 'agents/b', autoApprove: true }];
    expect(
      evaluateSubagentApproval({ fromPath: 'agents/c', toPath: 'agents/d' }, rules)
    ).toBeNull();
  });

  it('matches exact from/to', () => {
    const rules: SubagentRule[] = [
      { from: 'agents/jeeves', to: 'agents/coding', autoApprove: true },
    ];
    expect(
      evaluateSubagentApproval({ fromPath: 'agents/jeeves', toPath: 'agents/coding' }, rules)
    ).toBe(true);
  });

  it('matches a prefix on the `to` field with path-aware boundaries', () => {
    // 'agents/coding' covers 'agents/coding/coder-1' (path prefix) but NOT
    // 'agents/coding-extra' (substring prefix that crosses a path component).
    const rules: SubagentRule[] = [
      { from: 'agents/jeeves', to: 'agents/coding', autoApprove: true },
    ];
    expect(
      evaluateSubagentApproval(
        { fromPath: 'agents/jeeves', toPath: 'agents/coding/coder-1' },
        rules
      )
    ).toBe(true);
    expect(
      evaluateSubagentApproval({ fromPath: 'agents/jeeves', toPath: 'agents/coding-extra' }, rules)
    ).toBeNull();
  });

  it('matches a prefix on both fields (coding → coding)', () => {
    const rules: SubagentRule[] = [
      { from: 'agents/coding', to: 'agents/coding', autoApprove: true },
    ];
    expect(
      evaluateSubagentApproval(
        { fromPath: 'agents/coding/coder-1', toPath: 'agents/coding/refactor' },
        rules
      )
    ).toBe(true);
  });

  it('treats `*` as match-anything', () => {
    const rules: SubagentRule[] = [{ from: '*', to: '*', autoApprove: true }];
    expect(
      evaluateSubagentApproval(
        { fromPath: 'agents/any/agent', toPath: 'agents/other/agent' },
        rules
      )
    ).toBe(true);
  });

  it('uses `$self` to require the field equal the spawner path', () => {
    const rules: SubagentRule[] = [{ from: '$self', to: '$self', autoApprove: true }];
    // self → self matches
    expect(evaluateSubagentApproval({ fromPath: 'agents/x', toPath: 'agents/x' }, rules)).toBe(
      true
    );
    // self → different agent does NOT match (no rule applies)
    expect(
      evaluateSubagentApproval({ fromPath: 'agents/x', toPath: 'agents/y' }, rules)
    ).toBeNull();
  });

  it('is first-match-wins (override before broader rule)', () => {
    const rules: SubagentRule[] = [
      { from: 'agents/jeeves', to: 'agents/coding/sensitive', autoApprove: false },
      { from: 'agents/jeeves', to: 'agents/coding', autoApprove: true },
    ];
    // Specific deny wins
    expect(
      evaluateSubagentApproval(
        { fromPath: 'agents/jeeves', toPath: 'agents/coding/sensitive' },
        rules
      )
    ).toBe(false);
    // Other coding paths still get the broad allow
    expect(
      evaluateSubagentApproval({ fromPath: 'agents/jeeves', toPath: 'agents/coding/safe' }, rules)
    ).toBe(true);
  });

  it('tolerates a trailing slash on the rule field', () => {
    const rules: SubagentRule[] = [
      { from: 'agents/coding/', to: 'agents/coding/', autoApprove: true },
    ];
    expect(
      evaluateSubagentApproval(
        { fromPath: 'agents/coding/coder-1', toPath: 'agents/coding/refactor' },
        rules
      )
    ).toBe(true);
  });
});

describe('resolveSubagentApproval', () => {
  it('appends BUILTIN_SUBAGENT_RULES after user rules', () => {
    // No user rules → built-in self-clone applies.
    expect(resolveSubagentApproval({ fromPath: 'agents/x', toPath: 'agents/x' }, [])).toBe(true);
    // No user rules + non-self → no match → default false.
    expect(resolveSubagentApproval({ fromPath: 'agents/x', toPath: 'agents/y' }, [])).toBe(false);
  });

  it('honors a user rule placed before the built-in (disable self-clone)', () => {
    const override: SubagentRule[] = [{ from: '$self', to: '$self', autoApprove: false }];
    expect(resolveSubagentApproval({ fromPath: 'agents/x', toPath: 'agents/x' }, override)).toBe(
      false
    );
  });

  it('matches the spec walkthrough table', () => {
    const userRules: SubagentRule[] = [
      { from: 'agents/jeeves', to: 'agents/coding', autoApprove: true },
      { from: 'agents/coding', to: 'agents/coding', autoApprove: true },
    ];
    // jeeves → jeeves: built-in self-clone matches (no user rule covers it).
    expect(
      resolveSubagentApproval({ fromPath: 'agents/jeeves', toPath: 'agents/jeeves' }, userRules)
    ).toBe(true);
    // jeeves → agents/coding/coder-1: first user rule matches.
    expect(
      resolveSubagentApproval(
        { fromPath: 'agents/jeeves', toPath: 'agents/coding/coder-1' },
        userRules
      )
    ).toBe(true);
    // coding/coder-1 → coding/refactor: second user rule matches.
    expect(
      resolveSubagentApproval(
        { fromPath: 'agents/coding/coder-1', toPath: 'agents/coding/refactor' },
        userRules
      )
    ).toBe(true);
    // coding/coder-1 → jeeves: no rule matches → default false.
    expect(
      resolveSubagentApproval(
        { fromPath: 'agents/coding/coder-1', toPath: 'agents/jeeves' },
        userRules
      )
    ).toBe(false);
  });
});

describe('BUILTIN_SUBAGENT_RULES', () => {
  it('contains only the self-clone allow rule', () => {
    expect(BUILTIN_SUBAGENT_RULES).toEqual([{ from: '$self', to: '$self', autoApprove: true }]);
  });
});
