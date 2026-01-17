import { PageType } from './page-type.enum';

export interface XPathMap {
  [fieldName: string]: string | undefined;
}

export interface ListingXPathMap {
  productCard: string;
  thumbnail: string;
  name: string;
  price: string;
  url: string;
  [key: string]: string | undefined;
}

export interface PDPXPathMap {
  brandName?: string;
  productName: string;
  price: string;
  description?: string;
  options?: string;
  detailImages?: string;
  [key: string]: string | undefined;
}

export interface XPathCache {
  id?: number;
  siteDomain: string;
  pageType: PageType;
  xpaths: XPathMap;
  createdAt?: Date;
  updatedAt?: Date;
}
