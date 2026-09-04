export function assertZeroSkippedDatabaseTests(output) {
  const summaries = [...String(output ?? '').matchAll(/^# skipped ([0-9]+)$/gmu)];
  if (summaries.length === 0) {
    throw new Error('Full database phase did not emit a TAP skipped-test summary');
  }

  const skipped = Number(summaries.at(-1)[1]);
  if (skipped !== 0) {
    throw new Error(`Full database phase skipped ${skipped} tests`);
  }
}
