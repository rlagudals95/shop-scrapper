export interface ListingProduct {
  thumbnail: string | null;
  name: string;
  price: string;
  url: string;
}

export interface ListingData {
  products: ListingProduct[];
}

export interface PDPData {
  brandName: string | null;
  productName: string;
  description: string | null;
  options: string[];
  price: string;
  detailImages: string[];
}

export type ExtractedData = ListingData | PDPData;

export function isListingData(data: ExtractedData): data is ListingData {
  return 'products' in data;
}

export function isPDPData(data: ExtractedData): data is PDPData {
  return 'productName' in data;
}
