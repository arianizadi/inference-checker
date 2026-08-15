import { describe, expect, test } from "bun:test";
import { ARTIFACT_LIMITS, validateArtifactSize } from "./route";

describe("artifact response limits", () => {
  test("uses a stricter compressed-byte limit for PNG artifacts", () => {
    expect(() => validateArtifactSize("mask.png", ARTIFACT_LIMITS.pngBytes)).not.toThrow();
    expect(() => validateArtifactSize("mask.png", ARTIFACT_LIMITS.pngBytes + 1)).toThrow(
      "limit is",
    );
    expect(() => validateArtifactSize("input.jpg", ARTIFACT_LIMITS.pngBytes + 1)).not.toThrow();
    expect(() => validateArtifactSize("input.jpg", ARTIFACT_LIMITS.imageBytes + 1)).toThrow(
      "limit is",
    );
  });
});
