import { NextRequest, NextResponse } from "next/server";
import { getBundleIndex, getSceneImagePath } from "../../../lib/data";
import {
  computeStatsFromMasks,
  readMaskHeader,
  readMaskIndices,
  type ModelStats,
} from "../../../lib/stats";

export interface ModelStatsError {
  modelName: string;
  message: string;
}

interface StatsPayload {
  stats: ModelStats[];
  errors: ModelStatsError[];
}

interface CachedStats {
  payload: StatsPayload;
  bytes: number;
}

export const STATS_CACHE_LIMITS = {
  entries: 16,
  bytes: 8 * 1024 * 1024,
} as const;
export const MAX_STATS_PIXEL_COMPARISONS = 128 * 1024 * 1024;

const statsCache = new Map<string, CachedStats>();
let statsCacheBytes = 0;

export function clearStatsCache(): void {
  statsCache.clear();
  statsCacheBytes = 0;
}

export function statsCacheUsage(): { entries: number; bytes: number } {
  return { entries: statsCache.size, bytes: statsCacheBytes };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cachedStats(key: string): StatsPayload | undefined {
  const cached = statsCache.get(key);
  if (!cached) return undefined;
  statsCache.delete(key);
  statsCache.set(key, cached);
  return cached.payload;
}

function cacheStats(key: string, payload: StatsPayload): void {
  const bytes = Buffer.byteLength(JSON.stringify(payload));
  if (bytes > STATS_CACHE_LIMITS.bytes) return;
  const previous = statsCache.get(key);
  if (previous) statsCacheBytes -= previous.bytes;
  statsCache.delete(key);
  statsCache.set(key, { payload, bytes });
  statsCacheBytes += bytes;

  while (
    statsCache.size > STATS_CACHE_LIMITS.entries ||
    statsCacheBytes > STATS_CACHE_LIMITS.bytes
  ) {
    const oldestKey = statsCache.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = statsCache.get(oldestKey);
    if (oldest) statsCacheBytes -= oldest.bytes;
    statsCache.delete(oldestKey);
  }
}

export function validateStatsWorkload(predictionPixelCounts: readonly number[]): void {
  let comparisons = 0;
  for (const pixelCount of predictionPixelCounts) {
    if (!Number.isSafeInteger(pixelCount) || pixelCount < 0) {
      throw new Error(`Invalid prediction pixel count: ${pixelCount}`);
    }
    comparisons += pixelCount;
  }
  if (!Number.isSafeInteger(comparisons) || comparisons > MAX_STATS_PIXEL_COMPARISONS) {
    throw new Error(
      `Scene requires ${comparisons.toLocaleString()} model-pixel comparisons; limit is ` +
        MAX_STATS_PIXEL_COMPARISONS.toLocaleString(),
    );
  }
}

export function GET(request: NextRequest) {
  const sceneId = new URL(request.url).searchParams.get("sceneId");
  if (!sceneId) {
    return NextResponse.json({ error: "Missing sceneId parameter" }, { status: 400 });
  }

  let bundle;
  try {
    bundle = getBundleIndex();
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 422 });
  }
  const scene = bundle.scenesById.get(sceneId);
  if (!scene) {
    return NextResponse.json(
      { error: `Scene ${JSON.stringify(sceneId)} not found` },
      { status: 404 },
    );
  }

  const cacheKey = `${bundle.root}\0${bundle.generation}\0${scene.id}`;
  const cached = cachedStats(cacheKey);
  if (cached) return NextResponse.json(cached);

  const payload: StatsPayload = { stats: [], errors: [] };
  let groundTruth;
  try {
    groundTruth = readMaskIndices(
      getSceneImagePath(scene.id, scene.groundTruth, bundle.root),
    );
  } catch (error) {
    const message = errorMessage(error);
    payload.errors = scene.models.map((model) => ({
      modelName: model.name,
      message: `Invalid ground truth for ${scene.id}: ${message}`,
    }));
    cacheStats(cacheKey, payload);
    return NextResponse.json(payload);
  }

  const predictions: Array<{
    model: (typeof scene.models)[number];
    path: string;
    pixels: number;
    header: { width: number; height: number };
  }> = [];
  for (const model of scene.models) {
    try {
      const predictionPath = getSceneImagePath(
        scene.id,
        model.filename,
        bundle.root,
      );
      const header = readMaskHeader(predictionPath);
      if (header.width !== groundTruth.width || header.height !== groundTruth.height) {
        throw new Error(
          `Size mismatch for ${model.name}: GT(${groundTruth.width}x${groundTruth.height}) ` +
            `vs prediction(${header.width}x${header.height})`,
        );
      }
      predictions.push({
        model,
        path: predictionPath,
        pixels: header.width * header.height,
        header,
      });
    } catch (error) {
      payload.errors.push({ modelName: model.name, message: errorMessage(error) });
    }
  }

  try {
    validateStatsWorkload(predictions.map((prediction) => prediction.pixels));
  } catch (error) {
    const message = errorMessage(error);
    payload.errors.push(
      ...predictions.map(({ model }) => ({ modelName: model.name, message })),
    );
    cacheStats(cacheKey, payload);
    return NextResponse.json(payload);
  }

  for (const { model, path: predictionPath, header } of predictions) {
    try {
      const prediction = readMaskIndices(predictionPath, header);
      payload.stats.push(
        computeStatsFromMasks(groundTruth, prediction, model.name, bundle.config),
      );
    } catch (error) {
      payload.errors.push({ modelName: model.name, message: errorMessage(error) });
    }
  }

  cacheStats(cacheKey, payload);
  return NextResponse.json(payload);
}
