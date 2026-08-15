import { afterEach, describe, expect, test } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { validateBundle } from "./inspect";

const roots: string[] = [];

function temporaryRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "inference-bundle-test-"));
  roots.push(root);
  return root;
}

function writeBundle(root: string): void {
  fs.writeFileSync(
    path.join(root, "config.json"),
    JSON.stringify({
      title: "Portable bundle",
      version: 1,
      labels: [
        { name: "object", readable: "Object", color: [1, 2, 3], evaluate: true },
      ],
    }),
  );
  const scene = path.join(root, "scene-1");
  fs.mkdirSync(scene);
  fs.writeFileSync(path.join(scene, "input.jpg"), "fixture");
  fs.writeFileSync(path.join(scene, "gt.png"), "fixture");
  fs.writeFileSync(path.join(scene, "model.png"), "fixture");
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("validateBundle", () => {
  test("accepts an external relative bundle without copying it", () => {
    const parent = temporaryRoot();
    const root = path.join(parent, "portable-bundle");
    fs.mkdirSync(root);
    writeBundle(root);
    expect(validateBundle("portable-bundle", parent)).toEqual({
      root,
      title: "Portable bundle",
      classCount: 1,
      sceneCount: 1,
      modelCount: 1,
    });
  });

  test("rejects missing and structurally invalid bundles", () => {
    const parent = temporaryRoot();
    expect(() => validateBundle("missing", parent)).toThrow("does not exist");
    expect(() => validateBundle(parent)).toThrow("Missing config.json");
  });
});
