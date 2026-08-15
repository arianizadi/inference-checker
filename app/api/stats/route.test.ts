import { afterEach, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { PNG } from "pngjs";
import {
  BUNDLE_ROOT_ENV,
  clearBundleIndexCache,
} from "../../../lib/data";
import {
  clearStatsCache,
  GET,
  STATS_CACHE_LIMITS,
  statsCacheUsage,
  validateStatsWorkload,
} from "./route";

let temporaryRoot: string | undefined;
const previousRoot = process.env[BUNDLE_ROOT_ENV];

function grayscalePng(classIndex: number): Buffer {
  const png = new PNG({ width: 1, height: 1 });
  png.data.set([classIndex, classIndex, classIndex, 255]);
  return PNG.sync.write(png, { colorType: 0, inputColorType: 6, bitDepth: 8 });
}

function createBundle(sceneCount: number): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stats-cache-test-"));
  temporaryRoot = root;
  fs.writeFileSync(
    path.join(root, "config.json"),
    JSON.stringify({
      version: 1,
      labels: [
        { name: "object", readable: "Object", evaluate: true, color: [1, 2, 3] },
      ],
    }),
  );
  const mask = grayscalePng(0);
  for (let index = 0; index < sceneCount; index++) {
    const scene = path.join(root, `scene-${index}`);
    fs.mkdirSync(scene);
    fs.writeFileSync(path.join(scene, "input.jpg"), "fixture");
    fs.writeFileSync(path.join(scene, "gt.png"), mask);
    fs.writeFileSync(path.join(scene, "model.png"), mask);
  }
  return root;
}

afterEach(() => {
  clearStatsCache();
  clearBundleIndexCache();
  if (previousRoot === undefined) delete process.env[BUNDLE_ROOT_ENV];
  else process.env[BUNDLE_ROOT_ENV] = previousRoot;
  if (temporaryRoot) fs.rmSync(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

describe("stats cache", () => {
  test("rejects a stats workload above the fixed CPU budget", () => {
    expect(() => validateStatsWorkload(16 * 1024 * 1024, 9)).toThrow(
      "model-pixel comparisons",
    );
    expect(() => validateStatsWorkload(1024 * 2048, 3)).not.toThrow();
  });

  test("deduplicates repeated scene work and enforces entry/byte bounds", async () => {
    process.env[BUNDLE_ROOT_ENV] = createBundle(STATS_CACHE_LIMITS.entries + 2);

    const repeated = Array.from({ length: 4 }, () =>
      GET(new NextRequest("http://localhost/api/stats?sceneId=scene-0")),
    );
    for (const response of repeated) expect(response.status).toBe(200);
    expect(statsCacheUsage().entries).toBe(1);

    for (let index = 1; index < STATS_CACHE_LIMITS.entries + 2; index++) {
      const response = GET(
        new NextRequest(`http://localhost/api/stats?sceneId=scene-${index}`),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.errors).toEqual([]);
    }
    const usage = statsCacheUsage();
    expect(usage.entries).toBe(STATS_CACHE_LIMITS.entries);
    expect(usage.bytes).toBeLessThanOrEqual(STATS_CACHE_LIMITS.bytes);
  });
});
