import { NextRequest, NextResponse } from "next/server";
import { getAllScenes, getConfig } from "../../../lib/data";
import { computeStats, type ModelStats } from "../../../lib/stats";

export interface ModelStatsError {
  modelName: string;
  message: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(req: NextRequest) {
  const sceneId = new URL(req.url).searchParams.get("sceneId");
  if (!sceneId) {
    return NextResponse.json({ error: "Missing sceneId parameter" }, { status: 400 });
  }

  let scene;
  let config;
  try {
    config = getConfig();
    scene = getAllScenes().find((candidate) => candidate.id === sceneId);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 422 });
  }
  if (!scene) {
    return NextResponse.json({ error: `Scene ${JSON.stringify(sceneId)} not found` }, { status: 404 });
  }

  const stats: ModelStats[] = [];
  const errors: ModelStatsError[] = [];
  for (const model of scene.models) {
    try {
      stats.push(
        computeStats(
          scene.id,
          scene.groundTruth,
          model.filename,
          model.name,
          undefined,
          config,
        ),
      );
    } catch (error) {
      errors.push({ modelName: model.name, message: errorMessage(error) });
    }
  }

  return NextResponse.json({ stats, errors });
}
