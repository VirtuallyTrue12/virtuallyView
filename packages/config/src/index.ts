export interface AppConfig {
  port: number;
  databasePath: string;
  logLevel: string;
  aiProvider?: string | undefined;
  aiModel?: string | undefined;
  themeDefault?: string | undefined;
  featureMockMode: boolean;
}

export function validateConfig(env: Record<string, string | undefined>): AppConfig {
  const port = parseInt(env.PORT || '3000', 10);
  if (isNaN(port)) throw new Error('PORT must be a number');
  return {
    port,
    databasePath: env.DATABASE_PATH || './data/app.sqlite',
    logLevel: env.LOG_LEVEL || 'info',
    aiProvider: env.AI_PROVIDER,
    aiModel: env.AI_MODEL,
    themeDefault: env.THEME_DEFAULT,
    featureMockMode: env.FEATURE_MOCK_MODE === 'true'
  };
}
