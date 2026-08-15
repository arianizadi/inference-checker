import { afterEach, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import {
  BUNDLE_LIMITS,
  bundleIndexCacheEntries,
  clearBundleIndexCache,
  getBundleIndex,
  getAllScenes,
  getConfig,
  resolveInferenceRoot,
  resolveArtifactPath,
  validateBundleRoot,
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
  clearBundleIndexCache();
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
  test("resolves an explicit external root and rejects invalid bundle roots", () => {
    const cwd = temporaryDirectory();
    const bundle = path.join(cwd, "bundle");
    fs.mkdirSync(bundle);
    expect(resolveInferenceRoot("bundle", cwd)).toBe(bundle);
    expect(resolveInferenceRoot(bundle, "/ignored")).toBe(bundle);
    expect(validateBundleRoot(bundle)).toBe(bundle);
    expect(() => validateBundleRoot(path.join(cwd, "missing"))).toThrow("does not exist");

    const file = path.join(cwd, "not-a-directory");
    fs.writeFileSync(file, "fixture");
    expect(() => validateBundleRoot(file)).toThrow("not a directory");

    const link = path.join(cwd, "linked-bundle");
    fs.symlinkSync(bundle, link);
    expect(() => validateBundleRoot(link)).toThrow("may not be a symbolic link");
  });

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

  test("bounds metadata before parsing", () => {
    const root = temporaryDirectory();
    fs.writeFileSync(
      path.join(root, "config.json"),
      `{"padding":"${"x".repeat(BUNDLE_LIMITS.configBytes)}"}`,
    );
    expect(() => getConfig(root)).toThrow("limit is");

    fs.rmSync(path.join(root, "config.json"));
    const scene = path.join(root, "scene-oversized");
    fs.mkdirSync(scene);
    fs.writeFileSync(path.join(scene, "input.jpg"), "fixture");
    fs.writeFileSync(path.join(scene, "gt.png"), "fixture");
    fs.writeFileSync(
      path.join(scene, "scene.json"),
      `{"padding":"${"x".repeat(BUNDLE_LIMITS.sceneManifestBytes)}"}`,
    );
    expect(() => getAllScenes(root)).toThrow("limit is");
  });

  test("uses a bounded process-lifetime bundle index with explicit refresh", () => {
    const roots: string[] = [];
    for (let index = 0; index < 5; index++) {
      const root = temporaryDirectory();
      roots.push(root);
      fs.writeFileSync(path.join(root, "config.json"), JSON.stringify(validConfig()));
      const scene = path.join(root, `scene-${index}`);
      fs.mkdirSync(scene);
      fs.writeFileSync(path.join(scene, "input.jpg"), "fixture");
      fs.writeFileSync(path.join(scene, "gt.png"), "fixture");
      getBundleIndex(root);
    }
    expect(bundleIndexCacheEntries()).toBe(4);
    const first = getBundleIndex(roots[4]);
    expect(getBundleIndex(roots[4])).toBe(first);
    clearBundleIndexCache();
    expect(getBundleIndex(roots[4])).not.toBe(first);
  });

  test("rejects traversal and absolute path components", () => {
    const root = temporaryDirectory();
    expect(() => resolveArtifactPath(root, "../secret.png")).toThrow("safe filename");
    expect(() => resolveArtifactPath(root, "/tmp/secret.png")).toThrow("safe filename");
    expect(() => resolveArtifactPath(root, "scene", "..")).toThrow("safe filename");
  });

  test("ignores portable-archive and staging siblings but validates real scenes", () => {
    const root = temporaryDirectory();
    const archiveMetadata = path.join(root, "__MACOSX");
    fs.mkdirSync(archiveMetadata);
    fs.writeFileSync(path.join(archiveMetadata, "junk"), "fixture");

    const stagingTarget = temporaryDirectory();
    fs.symlinkSync(stagingTarget, path.join(root, "staging-link"));

    const validScene = path.join(root, "scene-01");
    fs.mkdirSync(validScene);
    fs.writeFileSync(path.join(validScene, "input.jpg"), "fixture");
    fs.writeFileSync(path.join(validScene, "gt.png"), "fixture");
    expect(getAllScenes(root).map((scene) => scene.id)).toEqual(["scene-01"]);

    const linkedScene = path.join(root, "scene-linked");
    fs.mkdirSync(linkedScene);
    fs.writeFileSync(path.join(linkedScene, "input.jpg"), "fixture");
    fs.symlinkSync(path.join(validScene, "gt.png"), path.join(linkedScene, "gt.png"));
    expect(() => getAllScenes(root)).toThrow("Symbolic links are not allowed");
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
    expect(Object.hasOwn(scenes[0].models[0].provenance ?? {}, "source")).toBe(false);
    expect({
      ...scenes[0].provenance,
      ...scenes[0].models[0].provenance,
    }).toMatchObject({ source: "ExampleSet", checkpoint: "sha256:abc" });
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
