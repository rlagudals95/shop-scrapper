import { PageType } from './page-type.enum';

export interface SelectorMap {
  [fieldName: string]: string | undefined;
}

export interface ListingSelectorMap {
  productCard: string;
  thumbnail: string;
  name: string;
  price: string;
  url: string;
  [key: string]: string | undefined;
}

export interface PDPSelectorMap {
  brandName?: string;
  productName: string;
  price: string;
  description?: string;
  options?: string;
  detailImages?: string;
  [key: string]: string | undefined;
}

export interface SelectorCache {
  id?: number;
  siteDomain: string;
  pageType: PageType;
  selectors: SelectorMap;
  createdAt?: Date;
  updatedAt?: Date;
}

// Backward compatibility aliases (deprecated - will be removed)
/** @deprecated Use SelectorMap instead */
export type XPathMap = SelectorMap;
/** @deprecated Use ListingSelectorMap instead */
export type ListingXPathMap = ListingSelectorMap;
/** @deprecated Use PDPSelectorMap instead */
export type PDPXPathMap = PDPSelectorMap;
/** @deprecated Use SelectorCache instead */
export type XPathCache = SelectorCache;
