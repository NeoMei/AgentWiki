export function errorWithTestDatabaseCleanup(primary, cleanupErrors, label) {
  if (primary === undefined) {
    if (cleanupErrors.length === 0) return undefined;
    if (cleanupErrors.length === 1) return cleanupErrors[0];
    return new AggregateError(cleanupErrors, `${label} cleanup failed`);
  }
  if (cleanupErrors.length === 0) return primary;

  const aggregate = new AggregateError(cleanupErrors, `${label} cleanup also failed`);
  if (typeof primary === 'object' && primary !== null) {
    try {
      if (primary.cause === undefined) primary.cause = aggregate;
      else primary.testDatabaseCleanupError = aggregate;
      return primary;
    } catch {
      // A frozen primary value is preserved as the AggregateError cause below.
    }
  }
  return new AggregateError(
    [primary, ...cleanupErrors],
    `${label} operation and cleanup failed`,
    { cause: primary },
  );
}
