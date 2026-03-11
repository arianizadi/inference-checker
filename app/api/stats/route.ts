import { NextRequest, NextResponse } from 'next/server';
import { getAllScenes, getConfig } from '../../../lib/data';
import { computeStats, ModelStats } from '../../../lib/stats';

// In-memory cache: sceneId -> model stats array
const statsCache = new Map<string, ModelStats[]>();

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sceneId = searchParams.get('sceneId');

  if (!sceneId) {
    return NextResponse.json({ error: 'Missing sceneId parameter' }, { status: 400 });
  }

  // Check cache first
  if (statsCache.has(sceneId)) {
    return NextResponse.json({ stats: statsCache.get(sceneId) });
  }

  // Find the scene
  const scenes = getAllScenes();
  const scene = scenes.find((s) => s.id === sceneId);
  if (!scene) {
    return NextResponse.json({ error: `Scene ${sceneId} not found` }, { status: 404 });
  }

  // Compute stats for all models in this scene
  const config = getConfig();
  const modelStats: ModelStats[] = [];

  for (const model of scene.models) {
    try {
      const stats = computeStats(sceneId, scene.groundTruth, model.filename, model.name);
      modelStats.push(stats);
    } catch (e) {
      console.error(`Error computing stats for ${model.name} in ${sceneId}:`, e);
    }
  }

  // Cache the result
  statsCache.set(sceneId, modelStats);

  return NextResponse.json({ stats: modelStats });
}
