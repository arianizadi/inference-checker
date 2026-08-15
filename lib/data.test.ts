import { afterEach, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import {
  getAllScenes,
  getConfig,
  resolveArtifactPath,
  validateConfig,
} from "./data";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "inference-checker-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function validConfig(title = "Test Dataset") {
  return {
    title,
    version: 1,
    labels: [
      {
        name: "background",
        readable: "Background",
        evaluate: true,
        color: [0, 0, 0],
      },
      {
        name: "object",
        readable: "Object",
        evaluate: true,
        color: [255, 0, 0],
      },
    ],
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("validateConfig", () => {
  test("accepts a dataset-agnostic config and defaults ignoreIndex", () => {
    const config = validateConfig(validConfig());
    expect(config.title).toBe("Test Dataset");
    expect(config.labels).toHaveLength(2);
    expect(config.ignoreIndex).toBe(255);
  });

  test("rejects duplicate names, invalid colors, and overlapping ignore indexes", () => {
    const duplicate = validConfig();
    duplicate.labels[1].name = "background";
    expect(() => validateConfig(duplicate)).toThrow("Duplicate class name");

    const badColor = validConfig();
    badColor.labels[0].color = [0, 0, 999];
    expect(() => validateConfig(badColor)).toThrow("three integers");

    expect(() => validateConfig({ ...validConfig(), ignoreIndex: 1 })).toThrow(
      "must not overlap",
    );
  });

  test("normalizes Segmentary's canonical taxonomy document", () => {
    const config = validateConfig({
      schema_version: 1,
      taxonomy: {
        name: "rail_union",
        description: "Canonical rail space",
        ignore_index: 255,
        classes: [
          { id: 0, name: "road", color: [128, 64, 128], evaluate: true },
          { id: 1, name: "rail-track", color: [230, 150, 140], evaluate: true },
        ],
      },
    });
    expect(config.dataset).toBe("rail_union");
    expect(config.labels[1]).toMatchObject({ name: "rail-track", readable: "rail-track" });
    expect(config.ignoreIndex).toBe(255);
  });
});

describe("artifact loading", () => {
  test("prefers config.json while retaining rs19-config.json fallback", () => {
    const root = temporaryDirectory();
    fs.writeFileSync(
      path.join(root, "rs19-config.json"),
      JSON.stringify(validConfig("Legacy")),
    );
    expect(getConfig(root).title).toBe("Legacy");

    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify(validConfig("Canonical")));
    expect(getConfig(root).title).toBe("Canonical");
  });

  test("rejects traversal and absolute path components", () => {
    const root = temporaryDirectory();
    expect(() => resolveArtifactPath(root, "../secret.png")).toThrow("safe filename");
    expect(() => resolveArtifactPath(root, "/tmp/secret.png")).toThrow("safe filename");
    expect(() => resolveArtifactPath(root, "scene", "..")).toThrow("safe filename");
  });

  test("loads optional scene and model provenance", () => {
    const root = temporaryDirectory();
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify(validConfig()));
    const scene = path.join(root, "scene-01");
    fs.mkdirSync(scene);
    for (const filename of ["input.jpg", "gt.png", "prediction.png"]) {
      fs.writeFileSync(path.join(scene, filename), "fixture");
    }
    fs.writeFileSync(
      path.join(scene, "scene.json"),
      JSON.stringify({
        title: "Validation frame 1",
        provenance: { source: "ExampleSet", split: "validation", frame: "1" },
        models: {
          "prediction.png": {
            displayName: "Model A",
            checkpoint: "sha256:abc",
            commit: "deadbeef",
          },
        },
      }),
    );

    const scenes = getAllScenes(root);
    expect(scenes).toHaveLength(1);
    expect(scenes[0].title).toBe("Validation frame 1");
    expect(scenes[0].provenance?.split).toBe("validation");
    expect(scenes[0].models[0]).toMatchObject({
      name: "Model A",
      filename: "prediction.png",
      provenance: { checkpoint: "sha256:abc", commit: "deadbeef" },
    });
  });

  test("fails when metadata references a missing model artifact", () => {
    const root = temporaryDirectory();
    const scene = path.join(root, "scene-01");
    fs.mkdirSync(scene);
    fs.writeFileSync(path.join(scene, "input.jpg"), "fixture");
    fs.writeFileSync(path.join(scene, "gt.png"), "fixture");
    fs.writeFileSync(
      path.join(scene, "scene.json"),
      JSON.stringify({ models: { "missing.png": { model: "Missing" } } }),
    );
    expect(() => getAllScenes(root)).toThrow("metadata for missing model artifact");
  });

  test("normalizes Segmentary exporter provenance", () => {
    const root = temporaryDirectory();
    const scene = path.join(root, "rs04890");
    fs.mkdirSync(scene);
    for (const filename of ["input.png", "gt.png", "rail-only.png"]) {
      fs.writeFileSync(path.join(scene, filename), "fixture");
    }
    fs.writeFileSync(
      path.join(scene, "scene.json"),
      JSON.stringify({
        schema_version: 1,
        frame_key: "rs04890",
        dataset: "railsem19",
        split: "val",
        predictions: {
          "rail-only": {
            name: "EoMT Rail only",
            file: "rail-only.png",
            weights: "ema",
            checkpoint: { file: "best.ckpt", sha256: "abc" },
            config: { hash: "cfg-hash", sha256: "def" },
            segmentary: { git_sha: "deadbeef", git_dirty: false },
            protocol: { inference: "sliding_window", window: [640, 640] },
          },
        },
      }),
    );

    const loaded = getAllScenes(root)[0];
    expect(loaded.inputImage).toBe("input.png");
    expect(loaded.models).toHaveLength(1);
    expect(loaded.provenance).toMatchObject({
      source: "railsem19",
      split: "val",
      frame: "rs04890",
    });
    expect(loaded.models[0]).toMatchObject({
      name: "EoMT Rail only",
      provenance: {
        model: "rail-only",
        checkpoint: "best.ckpt · sha256:abc",
        commit: "deadbeef",
        notes: "weights=ema",
      },
    });
  });
});
