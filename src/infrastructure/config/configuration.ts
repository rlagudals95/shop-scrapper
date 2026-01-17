export interface AppConfig {
  geminiApiKey: string;
  databasePath: string;
  browser: {
    headless: boolean;
    timeout: number;
  };
  crawler: {
    maxRetries: number;
    retryDelay: number;
  };
}

export default (): AppConfig => ({
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  databasePath: process.env.DATABASE_PATH || './data/crawler.db',
  browser: {
    headless: process.env.BROWSER_HEADLESS !== 'false',
    timeout: parseInt(process.env.BROWSER_TIMEOUT || '30000', 10),
  },
  crawler: {
    maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
    retryDelay: parseInt(process.env.RETRY_DELAY || '1000', 10),
  },
});
