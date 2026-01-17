import { PageType, XPathCache, XPathMap } from '../entities';

export interface IXPathRepository {
  findByDomain(domain: string, pageType: PageType): Promise<XPathCache | null>;
  upsert(domain: string, pageType: PageType, xpaths: XPathMap): Promise<XPathCache>;
  invalidate(domain: string, pageType?: PageType): Promise<void>;
  findAll(): Promise<XPathCache[]>;
  clearAll(): Promise<void>;
}
