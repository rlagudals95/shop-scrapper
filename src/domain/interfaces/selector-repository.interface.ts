import { PageType, SelectorCache, SelectorMap } from '../entities';

export interface ISelectorRepository {
  findByDomain(domain: string, pageType: PageType): Promise<SelectorCache | null>;
  upsert(domain: string, pageType: PageType, selectors: SelectorMap): Promise<SelectorCache>;
  invalidate(domain: string, pageType?: PageType): Promise<void>;
  findAll(): Promise<SelectorCache[]>;
  clearAll(): Promise<void>;
}

// Backward compatibility alias (deprecated - will be removed)
/** @deprecated Use ISelectorRepository instead */
export type IXPathRepository = ISelectorRepository;
