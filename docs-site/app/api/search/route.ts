import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

// Built once at deploy time; the search dialog downloads it and searches in the browser.
export const revalidate = false;
export const { staticGET: GET } = createFromSource(source);
