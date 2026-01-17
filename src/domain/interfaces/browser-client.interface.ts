export interface IBrowserClient {
  getPageContent(url: string): Promise<string>;
  close(): Promise<void>;
}
