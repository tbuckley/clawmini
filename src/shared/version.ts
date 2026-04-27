import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let cached: string | null = null;

/**
 * Read the version from the clawmini package.json. Walks up from the current
 * module's location until a package.json named "clawmini" is found.
 */
export function getClawminiVersion(): string {
  if (cached !== null) return cached;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (dir !== path.parse(dir).root) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
          name?: string;
          version?: string;
        };
        if (pkg.name === 'clawmini' && typeof pkg.version === 'string') {
          cached = pkg.version;
          return cached;
        }
      } catch {
        // try parent
      }
    }
    dir = path.dirname(dir);
  }
  cached = 'unknown';
  return cached;
}
