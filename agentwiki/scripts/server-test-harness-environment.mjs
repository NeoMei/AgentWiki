export function isolatedServerTestEnvironment(environment, generatedDatabaseUrl) {
  return {
    ...environment,
    DATABASE_URL: generatedDatabaseUrl,
    COLLABORATION_TEST_DATABASE_URL: generatedDatabaseUrl,
    SYNC_V3_TEST_DATABASE_URL: generatedDatabaseUrl,
  };
}
