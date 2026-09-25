// Diagnostics are written for a model as much as for a person: what is wrong, where, and the exact fix.

export interface Diagnostic {
  level: 'error' | 'warning';
  /** JSON path into script.json, such as "scenes[1].beats[0].at", or "" for the whole file. */
  path: string;
  message: string;
  fix?: string;
  /**
   * The fix as an exact change, when there is exactly one right answer (a typo with one close
   * match, a dash): set the value at this path in script.json. "check --fix" and "verify --fix"
   * apply it, so an agent need not spend a turn on it.
   */
  edit?: { path: (string | number)[]; value: unknown };
}

export function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const key of path) {
    if (typeof key === 'number') out += `[${key}]`;
    else out += out === '' ? String(key) : `.${String(key)}`;
  }
  return out;
}

export function formatDiagnostics(diagnostics: readonly Diagnostic[]): string {
  return diagnostics
    .map((d) => {
      const lines = [`${d.level.padEnd(7)} ${d.path || '(file)'}`, `        ${d.message}`];
      if (d.fix) lines.push(`        Fix: ${d.fix}`);
      return lines.join('\n');
    })
    .join('\n\n');
}

/** Closest candidate by edit distance, when it is close enough to be a likely typo. */
export function closest(word: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const d = editDistance(word.toLowerCase(), candidate.toLowerCase());
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best !== undefined && bestDistance <= Math.max(2, Math.floor(word.length / 3)) ? best : undefined;
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return previous[b.length]!;
}
