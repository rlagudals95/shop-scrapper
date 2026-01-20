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
  proxy?: {
    enabled: boolean;
    server: string;
    username: string;
    password: string;
  };
}

export default (): AppConfig => {
  const brightDataApiKey = process.env.BRIGHT_DATA_API_KEY;
  const brightDataCustomerId = process.env.BRIGHT_DATA_CUSTOMER_ID || 'hl_8b7f0cc7';
  const brightDataZone = process.env.BRIGHT_DATA_ZONE || 'residential_proxy1';
  const brightDataPort = process.env.BRIGHT_DATA_PORT || '33335';
  // 국가/도시 설정 (옵션) - 비어있으면 국가 설정 없이 기본 프록시 사용
  const brightDataCountry = process.env.BRIGHT_DATA_COUNTRY || '';
  const brightDataCity = process.env.BRIGHT_DATA_CITY || '';
  const proxyEnabled = process.env.PROXY_ENABLED === 'true' && !!brightDataApiKey;

  // 프록시 사용자명 생성
  let proxyUsername = `brd-customer-${brightDataCustomerId}-zone-${brightDataZone}`;
  if (brightDataCountry) {
    proxyUsername += `-country-${brightDataCountry}`;
    if (brightDataCity) {
      proxyUsername += `-city-${brightDataCity}`;
    }
  }

  // 프록시 설정 로깅
  if (proxyEnabled) {
    console.log(`[Config] Proxy enabled: ${proxyUsername}:${brightDataPort}`);
  }

  return {
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
    proxy: proxyEnabled
      ? {
          enabled: true,
          server: `brd.superproxy.io:${brightDataPort}`,
          username: proxyUsername,
          password: brightDataApiKey,
        }
      : undefined,
  };
};
