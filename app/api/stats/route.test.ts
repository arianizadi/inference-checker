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
  const png = new PNG({ width: 2, height: 2 });
  for (let pixel = 0; pixel < 4; pixel++) {
    png.data.set([classIndex, classIndex, classIndex, 255], pixel * 4);
  }
  return PNG.sync.write(png, { colorType: 0, inputColorType: 6, bitDepth: 8 });
}

function fakePngHeader(width: number, height: number): Buffer {
  const header = Buffer.alloc(29);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  header[24] = 8;
  header[25] = 0;
  return header;
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
        { name: "other", readable: "Other", evaluate: true, color: [4, 5, 6] },
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
    expect(() => validateStatsWorkload(Array(9).fill(16 * 1024 * 1024))).toThrow(
      "model-pixel comparisons",
    );
    expect(() => validateStatsWorkload(Array(3).fill(1024 * 2048))).not.toThrow();
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

  test("preflights every prediction dimension before decoding", async () => {
    const root = createBundle(1);
    const scene = path.join(root, "scene-0");
    for (let index = 0; index < 64; index++) {
      fs.writeFileSync(
        path.join(scene, `oversized-${index}.png`),
        fakePngHeader(4000, 4000),
      );
    }
    process.env[BUNDLE_ROOT_ENV] = root;

    const started = performance.now();
    const response = GET(new NextRequest("http://localhost/api/stats?sceneId=scene-0"));
    const elapsed = performance.now() - started;
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.stats).toHaveLength(1);
    expect(body.errors).toHaveLength(64);
    expect(body.errors[0].message).toContain("Size mismatch");
    expect(statsCacheUsage().entries).toBe(1);
    expect(elapsed).toBeLessThan(1000);
  });

  test("caches deterministic errors and invalidates results across bundle generations", async () => {
    const root = createBundle(1);
    const prediction = path.join(root, "scene-0", "model.png");
    process.env[BUNDLE_ROOT_ENV] = root;

    fs.writeFileSync(prediction, "broken");
    let response = GET(new NextRequest("http://localhost/api/stats?sceneId=scene-0"));
    expect((await response.json()).errors).toHaveLength(1);
    expect(statsCacheUsage().entries).toBe(1);

    fs.writeFileSync(prediction, grayscalePng(0));
    response = GET(new NextRequest("http://localhost/api/stats?sceneId=scene-0"));
    expect((await response.json()).errors).toHaveLength(1);
    expect(statsCacheUsage().entries).toBe(1);

    clearBundleIndexCache();
    response = GET(new NextRequest("http://localhost/api/stats?sceneId=scene-0"));
    expect((await response.json()).stats[0].mIoU).toBe(100);
    expect(statsCacheUsage().entries).toBe(2);

    fs.writeFileSync(prediction, grayscalePng(1));
    clearBundleIndexCache();
    response = GET(new NextRequest("http://localhost/api/stats?sceneId=scene-0"));
    expect((await response.json()).stats[0].mIoU).toBe(0);
    expect(statsCacheUsage().entries).toBe(3);
  });
});
