import type { Credentials, PendingRun, Preferences, RecentImage, ScaleMode } from '../shared/messages';

// What the plugin keeps in figma.clientStorage. Client storage is local to the
// user's machine and private to this plugin. Every value is checked on the way
// in and out, so a damaged or old value never breaks the plugin.

export const STORAGE_KEYS = {
  credentials: 'credentials',
  preferences: 'preferences',
  recent: 'recent',
  pending: 'pending',
} as const;

/** How many finished images the plugin remembers. */
export const RECENT_LIMIT = 24;

/** A run older than this is not looked up again when the plugin opens. */
export const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const MAX_TEXT = 4000;
const MAX_KEY = 512;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max = MAX_TEXT): string | undefined {
  return typeof value === 'string' && value.length <= max ? value : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && isFinite(value) ? value : undefined;
}

function isHttpsUrl(value: string): boolean {
  return /^https:\/\/[^\s/]+\/\S*$/.test(value);
}

export function parseCredentials(value: unknown): Credentials | null {
  if (!isObject(value)) return null;
  const apiKey = text(value.apiKey, MAX_KEY)?.trim();
  if (!apiKey) return null;
  const apiSecret = text(value.apiSecret, MAX_KEY)?.trim();
  return apiSecret ? { apiKey, apiSecret } : { apiKey };
}

function parseScaleMode(value: unknown): ScaleMode | undefined {
  return value === 'FILL' || value === 'FIT' ? value : undefined;
}

export function parsePreferences(value: unknown): Preferences {
  if (!isObject(value)) return {};
  const preferences: Preferences = {};
  const model = text(value.model, 200);
  if (model && /^[^/\s]+\/\S+$/.test(model)) preferences.model = model;
  const scaleMode = parseScaleMode(value.scaleMode);
  if (scaleMode) preferences.scaleMode = scaleMode;
  if (isObject(value.values)) {
    const values: Record<string, Record<string, string>> = {};
    for (const slug of Object.keys(value.values).slice(0, 100)) {
      const entry = value.values[slug];
      if (!isObject(entry)) continue;
      const settings: Record<string, string> = {};
      for (const id of Object.keys(entry).slice(0, 100)) {
        const setting = text(entry[id]);
        if (setting !== undefined) settings[id] = setting;
      }
      values[slug] = settings;
    }
    preferences.values = values;
  }
  return preferences;
}

export function parseRecent(value: unknown): RecentImage[] {
  if (!Array.isArray(value)) return [];
  const recent: RecentImage[] = [];
  for (const item of value) {
    if (!isObject(item)) continue;
    const url = text(item.url, 2000);
    const model = text(item.model, 200);
    const prompt = text(item.prompt);
    const createdAt = finite(item.createdAt);
    if (!url || !isHttpsUrl(url) || !model || prompt === undefined || createdAt === undefined) continue;
    const image: RecentImage = { url, model, prompt, createdAt };
    const taskId = text(item.taskId, 64);
    if (taskId) image.taskId = taskId;
    const width = finite(item.width);
    const height = finite(item.height);
    if (width && height) {
      image.width = width;
      image.height = height;
    }
    const cost = finite(item.costUsd);
    if (cost !== undefined) image.costUsd = cost;
    recent.push(image);
    if (recent.length >= RECENT_LIMIT) break;
  }
  return recent;
}

export function parsePending(value: unknown, now = Date.now()): PendingRun | null {
  if (!isObject(value)) return null;
  const tasktoken = text(value.tasktoken, 256);
  const model = text(value.model, 200);
  const prompt = text(value.prompt);
  const startedAt = finite(value.startedAt);
  if (!tasktoken || !model || prompt === undefined || startedAt === undefined) return null;
  if (now - startedAt > PENDING_MAX_AGE_MS) return null;
  const pending: PendingRun = { tasktoken, model, prompt, startedAt };
  const taskId = text(value.taskId, 64);
  if (taskId) pending.taskId = taskId;
  return pending;
}

/** The part of figma.clientStorage the plugin uses. */
export interface Storage {
  getAsync(key: string): Promise<unknown>;
  setAsync(key: string, value: unknown): Promise<void>;
  deleteAsync(key: string): Promise<void>;
}

export async function loadState(storage: Storage, now = Date.now()) {
  const [credentials, preferences, recent, pending] = await Promise.all([
    storage.getAsync(STORAGE_KEYS.credentials),
    storage.getAsync(STORAGE_KEYS.preferences),
    storage.getAsync(STORAGE_KEYS.recent),
    storage.getAsync(STORAGE_KEYS.pending),
  ]);
  return {
    credentials: parseCredentials(credentials),
    preferences: parsePreferences(preferences),
    recent: parseRecent(recent),
    pending: parsePending(pending, now),
  };
}

/** Saves a value after checking it, or removes the key when nothing valid is left. */
export async function saveCredentials(storage: Storage, value: unknown): Promise<void> {
  const credentials = parseCredentials(value);
  if (credentials) await storage.setAsync(STORAGE_KEYS.credentials, credentials);
  else await storage.deleteAsync(STORAGE_KEYS.credentials);
}

export async function savePreferences(storage: Storage, value: unknown): Promise<void> {
  await storage.setAsync(STORAGE_KEYS.preferences, parsePreferences(value));
}

export async function saveRecent(storage: Storage, value: unknown): Promise<void> {
  await storage.setAsync(STORAGE_KEYS.recent, parseRecent(value));
}

export async function savePending(storage: Storage, value: unknown, now = Date.now()): Promise<void> {
  const pending = parsePending(value, now);
  if (pending) await storage.setAsync(STORAGE_KEYS.pending, pending);
  else await storage.deleteAsync(STORAGE_KEYS.pending);
}
