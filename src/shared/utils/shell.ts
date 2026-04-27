// Splits a command string into argv the way a POSIX shell would, minus
// expansions: single-quoted strings are literal, double-quoted strings honor
// `\"` and `\\`, and an unquoted backslash escapes the next character.
// Throws when a quote is left open.
export function parseShellArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let hasContent = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inSingle) {
      if (ch === "'") inSingle = false;
      else current += ch;
      continue;
    }
    if (inDouble) {
      if (ch === '"') {
        inDouble = false;
      } else if (ch === '\\' && i + 1 < input.length) {
        const next = input[i + 1];
        if (next === '"' || next === '\\') {
          current += next;
          i++;
        } else {
          current += ch;
        }
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      hasContent = true;
    } else if (ch === '"') {
      inDouble = true;
      hasContent = true;
    } else if (ch === '\\' && i + 1 < input.length) {
      current += input[i + 1];
      i++;
      hasContent = true;
    } else if (ch === ' ' || ch === '\t') {
      if (hasContent) {
        args.push(current);
        current = '';
        hasContent = false;
      }
    } else {
      current += ch;
      hasContent = true;
    }
  }
  if (inSingle || inDouble) {
    throw new Error('Unterminated quote in command string.');
  }
  if (hasContent) args.push(current);
  return args;
}
