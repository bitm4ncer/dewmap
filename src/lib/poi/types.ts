export type PoiOsmType = "N" | "W" | "R";

export interface PoiImage {
  url: string;
  href?: string;
  credit: string;
  license?: string;
  licenseUrl?: string;
}

export interface PoiOpeningRow {
  day: string;
  ranges: string[];
  closed: boolean;
}

export interface PoiOpening {
  raw: string;
  rows: PoiOpeningRow[];
  openNow: boolean | null;
  todayIndex: number;
}

export interface PoiSocial {
  label: string;
  url: string;
}

export interface PoiFact {
  label: string;
  value: string;
}

export interface PoiSelection {
  osmType?: PoiOsmType;
  osmId?: number;
  lon: number;
  lat: number;
  name?: string;
  label?: string;
  category?: string;
  city?: string;
}

export interface PoiDetails {
  key: string;
  name: string;
  category: string;
  city?: string;
  address?: string;
  lat: number;
  lon: number;
  osmType: PoiOsmType;
  osmId: number;
  osmUrl: string;
  website?: string;
  phone?: string;
  email?: string;
  description?: string;
  wikipediaUrl?: string;
  wikidataUrl?: string;
  opening?: PoiOpening;
  socials: PoiSocial[];
  facts: PoiFact[];
  images: PoiImage[];
  checked?: string;
  tags: Record<string, string>;
}
