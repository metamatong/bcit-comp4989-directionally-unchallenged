import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CatalogueRecord } from '../src/types';

export const root = resolve(import.meta.dirname, '..');
export const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(resolve(root, path), 'utf8')) as T;
export const catalogue = readJson<CatalogueRecord[]>('data/campus/catalogue.json');
export const coverage = readJson('data/campus/coverage.json');
