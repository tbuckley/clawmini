export function applyEnvOverrides(
  targetEnv: Record<string, string>,
  overrides?: Record<string, string | boolean>
): void {
  if (!overrides) return;

  for (const [key, val] of Object.entries(overrides)) {
    if (val === true && process.env[key] !== undefined) {
      targetEnv[key] = process.env[key];
    } else if (typeof val === 'string') {
      targetEnv[key] = val;
    }
  }
}

export function getActiveEnvKeys(
  ...envs: (Record<string, string | boolean> | undefined)[]
): Set<string> {
  const keys = new Set<string>();
  for (const env of envs) {
    if (!env) continue;
    Object.entries(env).forEach(([key, val]) => {
      if (val === true || typeof val === 'string') keys.add(key);
    });
  }
  return keys;
}
