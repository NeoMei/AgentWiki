export interface DiffLine { kind: 'added' | 'removed' | 'unchanged'; text: string }
export interface LineDiff { lines: DiffLine[]; truncated: boolean }
const MAX_LINES = 300;
const MAX_CHARS = 100_000;

/** Small bounded LCS; long documents get an explicitly incomplete source preview. */
export function diffLines(before: string, after: string): LineDiff {
  const read = (source: string) => {
    if (!source) return { lines: [] as string[], truncated: false };
    const prefix = source.slice(0, MAX_CHARS);
    const lines = prefix.split('\n', MAX_LINES + 1);
    return { lines: lines.slice(0, MAX_LINES), truncated: source.length > MAX_CHARS || lines.length > MAX_LINES };
  };
  const left = read(before), right = read(after);
  const rows = Array.from({ length: left.lines.length + 1 }, () => new Uint16Array(right.lines.length + 1));
  for (let i = left.lines.length - 1; i >= 0; i -= 1) {
    for (let j = right.lines.length - 1; j >= 0; j -= 1) {
      rows[i][j] = left.lines[i] === right.lines[j] ? 1 + rows[i + 1][j + 1] : Math.max(rows[i + 1][j], rows[i][j + 1]);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < left.lines.length || j < right.lines.length) {
    if (i < left.lines.length && j < right.lines.length && left.lines[i] === right.lines[j]) {
      lines.push({ kind: 'unchanged', text: left.lines[i++] }); j += 1;
    } else if (i < left.lines.length && (j === right.lines.length || rows[i + 1][j] >= rows[i][j + 1])) {
      lines.push({ kind: 'removed', text: left.lines[i++] });
    } else {
      lines.push({ kind: 'added', text: right.lines[j++] });
    }
  }
  return { lines, truncated: left.truncated || right.truncated };
}
