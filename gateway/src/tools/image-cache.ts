/**
 * Image Cache — on-disk cache with TTL for vision images.
 *
 * Base64 bytes never persist in the messages array. Images are cached on disk
 * with a 24-hour TTL. Claire can re-view cached images via fetch_image and
 * permanently save images via remember_image. Nightly curation deletes expired entries.
 */

import { readFile, writeFile, mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import { randomBytes } from 'crypto';
import type Anthropic from '@anthropic-ai/sdk';

const CACHE_DIR = 'images';
const MANIFEST_FILE = 'manifest.json';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export interface ImageCacheEntry {
  id: string;
  filename: string;
  mimeType: string;
  receivedAt: string;
  expiresAt: string | null;
  saved: boolean;
  caption: string;
  summary: string;
  sizeBytes: number;
}

let workspacePath: string = '';

export function initImageCache(wsPath: string): void {
  workspacePath = wsPath;
}

function getCacheDir(): string {
  return join(workspacePath, CACHE_DIR);
}

function getManifestPath(): string {
  return join(getCacheDir(), MANIFEST_FILE);
}

async function ensureCacheDir(): Promise<void> {
  await mkdir(getCacheDir(), { recursive: true });
}

async function loadManifest(): Promise<ImageCacheEntry[]> {
  try {
    const raw = await readFile(getManifestPath(), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveManifest(entries: ImageCacheEntry[]): Promise<void> {
  await ensureCacheDir();
  await writeFile(getManifestPath(), JSON.stringify(entries, null, 2), 'utf-8');
}

function generateId(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const rand = randomBytes(3).toString('hex');
  return `img_${ts}_${rand}`;
}

function extFromMime(mimeType: string): string {
  if (mimeType.includes('png')) return '.png';
  if (mimeType.includes('gif')) return '.gif';
  if (mimeType.includes('webp')) return '.webp';
  return '.jpg';
}

/**
 * Cache an image on disk. Returns the manifest entry and base64 data
 * for immediate use in the API call.
 */
export async function cacheImage(
  buffer: Buffer,
  mimeType: string,
  caption: string
): Promise<{ entry: ImageCacheEntry; base64: string }> {
  await ensureCacheDir();

  const id = generateId();
  const ext = extFromMime(mimeType);
  const filename = `${id}${ext}`;
  const filePath = join(getCacheDir(), filename);

  await writeFile(filePath, buffer);

  const now = new Date();
  const entry: ImageCacheEntry = {
    id,
    filename,
    mimeType,
    receivedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + DEFAULT_TTL_MS).toISOString(),
    saved: false,
    caption,
    summary: '',
    sizeBytes: buffer.length,
  };

  const manifest = await loadManifest();
  manifest.push(entry);
  await saveManifest(manifest);

  console.log(`[image-cache] Cached ${filename} (${Math.round(buffer.length / 1024)}KB, expires in 24h)`);

  return { entry, base64: buffer.toString('base64') };
}

/**
 * Fetch a cached image by ID. Returns the image content block if available,
 * or a text-only result if expired/missing.
 */
export async function fetchImage(
  id: string
): Promise<
  | { available: true; entry: ImageCacheEntry; contentBlock: Anthropic.ImageBlockParam }
  | { available: false; reason: string; summary: string }
> {
  const manifest = await loadManifest();
  const entry = manifest.find(e => e.id === id);

  if (!entry) {
    return { available: false, reason: 'Image not found in cache.', summary: '' };
  }

  if (!entry.saved && entry.expiresAt && new Date(entry.expiresAt) < new Date()) {
    return {
      available: false,
      reason: 'Image has expired (past 24-hour window).',
      summary: entry.summary || entry.caption || 'No description available.',
    };
  }

  try {
    const filePath = join(getCacheDir(), entry.filename);
    const buffer = await readFile(filePath);
    const base64 = buffer.toString('base64');

    const contentBlock: Anthropic.ImageBlockParam = {
      type: 'image',
      source: {
        type: 'base64',
        media_type: entry.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
        data: base64,
      },
    };

    return { available: true, entry, contentBlock };
  } catch {
    return {
      available: false,
      reason: 'Image file missing from cache.',
      summary: entry.summary || entry.caption || 'No description available.',
    };
  }
}

/**
 * Mark an image as permanently saved (no expiry).
 */
export async function rememberImage(id: string): Promise<string> {
  const manifest = await loadManifest();
  const entry = manifest.find(e => e.id === id);

  if (!entry) {
    return `Image ${id} not found in cache.`;
  }

  if (entry.saved) {
    return `Image ${id} is already saved permanently.`;
  }

  entry.saved = true;
  entry.expiresAt = null;
  await saveManifest(manifest);

  console.log(`[image-cache] Permanently saved ${entry.filename}`);
  return `Image ${id} saved permanently. It will not expire.`;
}

/**
 * Update the text summary for a cached image.
 */
export async function updateImageSummary(id: string, summary: string): Promise<void> {
  const manifest = await loadManifest();
  const entry = manifest.find(e => e.id === id);
  if (entry) {
    entry.summary = summary;
    await saveManifest(manifest);
  }
}

/**
 * Delete expired images from the cache. Returns a summary of what was cleaned.
 */
export async function cleanExpiredImages(): Promise<string> {
  const manifest = await loadManifest();
  const now = new Date();
  const kept: ImageCacheEntry[] = [];
  const cleaned: string[] = [];

  for (const entry of manifest) {
    if (!entry.saved && entry.expiresAt && new Date(entry.expiresAt) < now) {
      try {
        await unlink(join(getCacheDir(), entry.filename));
      } catch {
        // File already gone — fine
      }
      cleaned.push(`${entry.id} (${entry.caption || 'no caption'})`);
    } else {
      kept.push(entry);
    }
  }

  await saveManifest(kept);

  if (cleaned.length > 0) {
    console.log(`[image-cache] Cleaned ${cleaned.length} expired image(s)`);
    return `Cleaned ${cleaned.length} expired image(s): ${cleaned.join(', ')}. ${kept.length} image(s) retained.`;
  }

  return `No expired images to clean. ${kept.length} image(s) in cache.`;
}

/**
 * Tool definitions for the Anthropic API.
 */
export function getImageToolDefinitions(): Anthropic.Tool[] {
  return [
    {
      name: 'fetch_image',
      description:
        'Look at a cached image again. Use when you want to re-view a photo that was shared earlier. ' +
        'Provide the image ID (e.g. img_20260311_143022_abc) from the conversation context. ' +
        'Images are available for 24 hours, or permanently if you saved them with remember_image.',
      input_schema: {
        type: 'object' as const,
        properties: {
          id: {
            type: 'string',
            description: 'The image cache ID (starts with img_)',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'remember_image',
      description:
        'Permanently save an image so it never expires. Use when a photo is personally meaningful ' +
        'and worth keeping — a face, a moment, something that matters to the relationship. ' +
        "Don't save functional screenshots or transient images.",
      input_schema: {
        type: 'object' as const,
        properties: {
          id: {
            type: 'string',
            description: 'The image cache ID to save permanently',
          },
        },
        required: ['id'],
      },
    },
  ];
}
