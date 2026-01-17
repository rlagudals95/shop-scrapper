export interface FetchOptions {
  /** Use Playwright instead of simple HTTP fetch */
  forcePlaywright?: boolean;
  /** Timeout in milliseconds */
  timeout?: number;
}

export interface FetchResult {
  html: string;
  /** Whether Playwright was used (fallback from HTTP) */
  usedPlaywright: boolean;
  /** Content length in bytes */
  contentLength: number;
}

export interface IBrowserClient {
  /**
   * Get page content using simple HTTP fetch first, fallback to Playwright if needed
   * @param url Target URL
   * @param options Fetch options
   */
  getPageContent(url: string, options?: FetchOptions): Promise<string>;

  /**
   * Get page content with detailed result information
   * @param url Target URL
   * @param options Fetch options
   */
  getPageContentWithInfo(url: string, options?: FetchOptions): Promise<FetchResult>;

  /**
   * Close browser resources
   */
  close(): Promise<void>;
}
