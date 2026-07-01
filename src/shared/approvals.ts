import { z } from 'zod';

// Approval rules for subagent spawn / send. The user-facing schema lives in
// `policies.json` under a new sibling `subagents` array; built-in rules are
// appended at evaluation time so a config that omits `subagents` still gets
// the safe default of `$self → $self`.
//
// See `docs/subagent-policy/spec.html` §4 for the full design (especially
// §4.2 for the built-ins, §4.4 for the resolution algorithm).

export interface SubagentRule {
  /** Agent path | path prefix | '*' (any) | '$self' (same as candidate.fromPath). */
  from: string;
  /** Agent path | path prefix | '*' (any) | '$self' (same as candidate.fromPath). */
  to: string;
  autoApprove: boolean;
}

export const SubagentRuleSchema = z.object({
  from: z.string(),
  to: z.string(),
  autoApprove: z.boolean(),
});

export const SubagentRulesSchema = z.array(SubagentRuleSchema);

export const BUILTIN_SUBAGENT_RULES: SubagentRule[] = [
  { from: '$self', to: '$self', autoApprove: true },
];

export interface SubagentApprovalCandidate {
  fromPath: string;
  toPath: string;
}

// Does `field` cover `value` given the candidate? A field "covers" a value if:
//   - it equals the value exactly, or
//   - it's `'*'` (matches anything), or
//   - it's `'$self'` (matches only when `value` equals `selfPath`), or
//   - it's a path prefix of the value (directory-prefix semantics).
//
// Prefix matching is path-aware: 'agents/coding' matches 'agents/coding/coder-1'
// but not 'agents/coding-extra'. We enforce this by requiring the next char
// after the prefix to be a path separator. Trailing slashes on the rule field
// are tolerated (`'agents/coding/'` is equivalent to `'agents/coding'`).
function fieldCovers(field: string, value: string, selfPath: string): boolean {
  if (field === '*') return true;
  if (field === '$self') return value === selfPath;
  if (field === value) return true;
  // Strip a trailing slash so 'agents/coding/' and 'agents/coding' are equivalent.
  const normalized = field.endsWith('/') ? field.slice(0, -1) : field;
  if (normalized === value) return true;
  return value.startsWith(normalized + '/');
}

/**
 * Evaluate a candidate spawn/send edge against an ordered rule list.
 *
 * The resolved list is `[...userRules, ...BUILTIN_SUBAGENT_RULES]` — built-ins
 * are appended at the call site, not here, so callers can prepend overrides
 * (e.g. a user rule `{from: '$self', to: '$self', autoApprove: false}` placed
 * before the built-in disables self-clone).
 *
 * Returns:
 *   - `true`  → first matching rule's `autoApprove` was `true` (auto-approve)
 *   - `false` → first matching rule's `autoApprove` was `false` (require user)
 *   - `null`  → no rule matched (caller defaults to "require user", per §4.4)
 */
export function evaluateSubagentApproval(
  candidate: SubagentApprovalCandidate,
  rules: SubagentRule[]
): boolean | null {
  for (const rule of rules) {
    if (
      fieldCovers(rule.from, candidate.fromPath, candidate.fromPath) &&
      fieldCovers(rule.to, candidate.toPath, candidate.fromPath)
    ) {
      return rule.autoApprove;
    }
  }
  return null;
}

/**
 * Resolve a candidate against a user rule list plus the built-in tail. Returns
 * the boolean result, mapping a no-match to `false` (the §4.4 default).
 */
export function resolveSubagentApproval(
  candidate: SubagentApprovalCandidate,
  userRules: SubagentRule[]
): boolean {
  const result = evaluateSubagentApproval(candidate, [...userRules, ...BUILTIN_SUBAGENT_RULES]);
  return result ?? false;
}
