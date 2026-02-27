import { sep } from 'node:path';

export function pathIsInsideDir(
  path: string,
  dir: string,
  { allowSameDir = false }: { allowSameDir?: boolean } = {}
): boolean {
  const dirWithSep = dir.endsWith(sep) ? dir : dir + sep;
  if (allowSameDir && path === dir) {
    return true;
  }
  return path.startsWith(dirWithSep) && path !== dir;
}
