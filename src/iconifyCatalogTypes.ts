import type { Icon } from './common';

export const CatalogFormat = 1;
export const CatalogFiles = ['index.sqlite', 'icons.bin'] as const;
export const PageSize = 128;
export const PageBytes = 1024 * 1024;
export const MaxIconBytes = 16 * 1024 * 1024;
export interface CatalogCategory {
  category: string;
  name: string;
  count: number;
}
export interface IconCursor {
  name: string;
  prefix: string;
  score: number;
  favoriteOffset?: number;
}
export interface IconQuery {
  text?: string;
  category?: string;
  favorites?: string[];
  cursor?: IconCursor;
}
export interface IconPage {
  icons: Icon[];
  nextCursor?: IconCursor;
}
export interface CatalogManifest {
  format: number;
  version: string;
  icons: number;
  files: { name: string; size: number; mtimeMs: number }[];
}
export type CatalogWorkerRequest =
  | { type: 'build'; source: string; directory: string; version: string }
  | { type: 'open'; directory: string }
  | { type: 'close' }
  | { type: 'query'; query: IconQuery };
