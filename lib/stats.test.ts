import { describe, expect, test } from "bun:test";
import type { SegmentationConfig } from "./data";
import { computeStatsFromMasks, type IndexMask } from "./stats";

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
