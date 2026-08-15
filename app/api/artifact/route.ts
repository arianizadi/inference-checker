import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { getBundleIndex, getSceneImagePath } from "../../../lib/data";
import { MASK_LIMITS } from "../../../lib/stats";

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export const ARTIFACT_LIMITS = {
  imageBytes: 128 * 1024 * 1024,
  pngBytes: MASK_LIMITS.compressedBytes,
} as const;

export function validateArtifactSize(filename: string, bytes: number): void {
  const limit = filename.toLowerCase().endsWith(".png")
    ? ARTIFACT_LIMITS.pngBytes
    : ARTIFACT_LIMITS.imageBytes;
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > limit) {
    throw new Error(
      `Artifact ${filename} is ${bytes.toLocaleString()} bytes; limit is ${limit.toLocaleString()} bytes`,
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(request: NextRequest) {
  const parameters = new URL(request.url).searchParams;
  const sceneId = parameters.get("sceneId");
  const filename = parameters.get("filename");
  if (!sceneId || !filename) {
    return NextResponse.json(
      { error: "Both sceneId and filename are required" },
      { status: 400 },
    );
  }

  try {
    const bundle = getBundleIndex();
    const scene = bundle.scenesById.get(sceneId);
    if (!scene) {
      return NextResponse.json({ error: "Scene not found" }, { status: 404 });
    }
    const allowedFiles = new Set([
      scene.inputImage,
      scene.groundTruth,
      ...scene.models.map((model) => model.filename),
    ]);
    if (!allowedFiles.has(filename)) {
      return NextResponse.json({ error: "Artifact not found in scene" }, { status: 404 });
    }

    const extension = filename.split(".").pop()?.toLowerCase() ?? "";
    const contentType = CONTENT_TYPES[extension];
    if (!contentType) {
      return NextResponse.json({ error: "Unsupported artifact type" }, { status: 415 });
    }
    const artifactPath = getSceneImagePath(scene.id, filename, bundle.root);
    validateArtifactSize(filename, fs.statSync(artifactPath).size);
    const bytes = fs.readFileSync(artifactPath);
    validateArtifactSize(filename, bytes.length);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 422 });
  }
}
