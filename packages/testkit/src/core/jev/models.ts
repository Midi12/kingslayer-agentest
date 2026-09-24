/**
 * Models the fake Jev server lists at `GET /v1/models`. `jev-1.13.0` is the model ARGUS
 * pins (thresholds are per model); `jev-latest` is the SDK's default name and resolves to it.
 */
import type { JevModelCard } from './types.js';

export const JEV_PINNED_MODEL = 'jev-1.13.0';

export const JEV_MODELS: readonly JevModelCard[] = [
  {
    name: 'jev-1.13.0',
    description: 'Jev 1.13.0 (fake): Noul, Choice and Score answers over text or JSON state',
    release_date: '2026-06-30',
  },
  {
    name: 'jev-1.12.0',
    description: 'Jev 1.12.0 (fake): the previous release, kept for pinned clients',
    release_date: '2026-03-31',
  },
];

export const JEV_MODEL_ALIASES: Readonly<Record<string, string>> = {
  'jev-latest': JEV_PINNED_MODEL,
};
