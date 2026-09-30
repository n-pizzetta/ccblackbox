export type ModelPrice = { in: number; out: number; cacheRead: number; cacheWrite: number; cacheWrite1h: number };
export type CostTokens = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cacheWrite1h?: number;
};

export const MODELS: Record<string, { label: string; in: number; out: number; cacheRead: number }>;
export const DEFAULT_MODEL: string;
export function setModelOverrides(overrides: unknown): Record<string, { label: string; in: number; out: number; cacheRead: number }>;
export function isKnownModel(model: string | null | undefined): boolean;
export function normalizeModel(id: string | null | undefined): string | null;
export function priceFor(model: string): ModelPrice;
export function modelLabel(model: string | null | undefined): string;
export function modelFamily(model: string | null | undefined): string;
export function costOf(model: string, t: CostTokens | null | undefined): number;
