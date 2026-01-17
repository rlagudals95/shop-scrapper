export class CrawlException extends Error {
  constructor(
    message: string,
    public readonly url?: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'CrawlException';
  }
}

export class ExtractionException extends CrawlException {
  constructor(
    message: string,
    url?: string,
    cause?: Error,
  ) {
    super(message, url, cause);
    this.name = 'ExtractionException';
  }
}

export class AnalysisException extends CrawlException {
  constructor(
    message: string,
    url?: string,
    cause?: Error,
  ) {
    super(message, url, cause);
    this.name = 'AnalysisException';
  }
}
