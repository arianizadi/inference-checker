import { afterEach, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { PNG } from "pngjs";
import type { SegmentationConfig } from "./data";
import {
  computeStatsFromMasks,
  MASK_LIMITS,
  readMaskHeader,
  readMaskIndices,
  type IndexMask,
} from "./stats";

const temporaryFiles: string[] = [];

afterEach(() => {
  for (const file of temporaryFiles.splice(0)) fs.rmSync(file, { force: true });
});

const config: SegmentationConfig = {
  version: 1,
  ignoreIndex: 255,
  labels: [
    { name: "background", readable: "Background", evaluate: true, color: [0, 0, 0] },
    { name: "object", readable: "Object", evaluate: true, color: [255, 0, 0] },
  ],
};

function mask(values: number[], width = 2, height = 2): IndexMask {
  return { indices: Uint8Array.from(values), width, height };
}

describe("computeStatsFromMasks", () => {
  test("computes exact class IoU, mean IoU, accuracy, and ignored pixels", () => {
    const stats = computeStatsFromMasks(
      mask([0, 0, 1, 255]),
      mask([0, 1, 1, 255]),
      "model-a",
      config,
    );

    expect(stats.mIoU).toBe(50);
    expect(stats.pixelAccuracy).toBeCloseTo(66.6666667);
    expect(stats.evaluatedPixels).toBe(3);
    expect(stats.ignoredPixels).toBe(1);
    expect(stats.gtPresentClassCount).toBe(2);
    expect(stats.predictionOnlyClasses).toEqual([]);
    expect(stats.classIoUs).toHaveLength(2);
    for (const classStats of stats.classIoUs) expect(classStats.iou).toBe(50);
  });

  test("uses a fixed GT-present denominator and reports hallucinated classes", () => {
    const threeClassConfig: SegmentationConfig = {
      ...config,
      labels: [
        ...config.labels,
        { name: "ghost", readable: "Ghost", evaluate: true, color: [0, 255, 0] },
      ],
    };
    const clean = computeStatsFromMasks(
      mask([0, 0, 0, 0]),
      mask([0, 0, 0, 0]),
      "clean",
      threeClassConfig,
    );
    const hallucinating = computeStatsFromMasks(
      mask([0, 0, 0, 0]),
      mask([0, 0, 0, 2]),
      "hallucinating",
      threeClassConfig,
    );

    expect(clean.mIoU).toBe(100);
    expect(hallucinating.mIoU).toBe(75);
    expect(hallucinating.unionMIoU).toBe(37.5);
    expect(hallucinating.gtPresentClassCount).toBe(1);
    expect(hallucinating.predictionOnlyClasses).toMatchObject([
      { name: "ghost", gtPixels: 0, predPixels: 1, iou: 0 },
    ]);
  });

  test("rejects dimension and decoded-length mismatches", () => {
    expect(() =>
      computeStatsFromMasks(mask([0, 0, 1, 1]), mask([0, 1], 1, 2), "bad", config),
    ).toThrow("Size mismatch");
    expect(() =>
      computeStatsFromMasks(mask([0], 2, 2), mask([0], 2, 2), "bad", config),
    ).toThrow("length does not match");
  });

  test("rejects invalid ground-truth and prediction class IDs", () => {
    expect(() =>
      computeStatsFromMasks(mask([0, 2, 1, 1]), mask([0, 0, 1, 1]), "bad", config),
    ).toThrow("Ground truth contains invalid class ID 2");
    expect(() =>
      computeStatsFromMasks(mask([0, 0, 1, 1]), mask([0, 2, 1, 1]), "bad", config),
    ).toThrow("invalid prediction class ID 2");
    expect(() =>
      computeStatsFromMasks(mask([0, 0, 1, 1]), mask([0, 255, 1, 1]), "bad", config),
    ).toThrow("predicts ignore index 255 on evaluated pixel");
  });

  test("excludes ground-truth classes marked evaluate false", () => {
    const ignoredClassConfig: SegmentationConfig = {
      ...config,
      labels: [config.labels[0], { ...config.labels[1], evaluate: false }],
    };
    const stats = computeStatsFromMasks(
      mask([0, 1, 0, 1]),
      mask([0, 0, 0, 0]),
      "model-a",
      ignoredClassConfig,
    );
    expect(stats.pixelAccuracy).toBe(100);
    expect(stats.evaluatedPixels).toBe(2);
    expect(stats.ignoredPixels).toBe(2);
    expect(stats.mIoU).toBe(100);
  });
});

describe("readMaskIndices", () => {
  test("rejects an RGB PNG even when all three channels contain the same value", () => {
    const png = new PNG({ width: 1, height: 1 });
    png.data.set([7, 7, 7, 255]);
    const file = path.join(os.tmpdir(), `inference-checker-rgb-mask-${process.pid}.png`);
    temporaryFiles.push(file);
    fs.writeFileSync(
      file,
      PNG.sync.write(png, { colorType: 2, inputColorType: 6, bitDepth: 8 }),
    );

    expect(() => readMaskIndices(file)).toThrow("must be 8-bit grayscale");
  });

  test("rejects malformed and oversized dimensions before PNG decompression", () => {
    const malformed = path.join(
      os.tmpdir(),
      `inference-checker-malformed-mask-${process.pid}.png`,
    );
    temporaryFiles.push(malformed);
    fs.writeFileSync(malformed, "not a png");
    expect(() => readMaskIndices(malformed)).toThrow("no valid PNG signature");

    const oversized = path.join(
      os.tmpdir(),
      `inference-checker-oversized-mask-${process.pid}.png`,
    );
    temporaryFiles.push(oversized);
    const header = Buffer.alloc(29);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
    header.writeUInt32BE(13, 8);
    header.write("IHDR", 12, "ascii");
    header.writeUInt32BE(MASK_LIMITS.dimension + 1, 16);
    header.writeUInt32BE(1, 20);
    header[24] = 8;
    header[25] = 0;
    fs.writeFileSync(oversized, header);
    expect(() => readMaskIndices(oversized)).toThrow("dimensions");
  });

  test("rejects an interlaced PNG header before reading its payload", () => {
    const interlaced = path.join(
      os.tmpdir(),
      `inference-checker-interlaced-mask-${process.pid}.png`,
    );
    temporaryFiles.push(interlaced);
    const payload = Buffer.alloc(255 * 1024);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(payload);
    payload.writeUInt32BE(13, 8);
    payload.write("IHDR", 12, "ascii");
    payload.writeUInt32BE(16, 16);
    payload.writeUInt32BE(16, 20);
    payload[24] = 8;
    payload[25] = 0;
    payload[26] = 0;
    payload[27] = 0;
    payload[28] = 1;
    fs.writeFileSync(interlaced, payload);

    expect(() => readMaskHeader(interlaced)).toThrow("must be non-interlaced");
    expect(() => readMaskIndices(interlaced)).toThrow("must be non-interlaced");
  });
});
