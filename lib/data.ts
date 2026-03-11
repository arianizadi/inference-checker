import fs from 'fs';
import path from 'path';

export interface RS19Class {
  color: [number, number, number];
  evaluate: boolean;
  instances: boolean;
  name: string;
  readable: string;
}

export interface RS19Config {
  labels: RS19Class[];
  version: number;
}

export interface ModelInfo {
  name: string;       // display name e.g. "deeplabv3plus"
  filename: string;   // just the PNG filename e.g. "deeplabv3plus.png"
}

export interface SceneData {
  id: string;              // scene directory name e.g. "rs00161"
  inputImage: string;      // e.g. "input.jpg"
  groundTruth: string;     // e.g. "gt.png"
  models: ModelInfo[];     // auto-discovered model predictions
}

const INFERENCE_DIR = path.join(process.cwd(), 'public', 'inference_comparison');

export function getConfig(): RS19Config {
  const configPath = path.join(INFERENCE_DIR, 'rs19-config.json');
  if (!fs.existsSync(configPath)) {
    // Return a minimal valid config if file is missing
    return { labels: [], version: 0 };
  }
  const fileContent = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(fileContent) as RS19Config;
}

/**
 * Discover all scenes in the inference_comparison directory.
 * Each subdirectory is a scene containing input.jpg, gt.png, and model PNGs.
 */
export function getAllScenes(): SceneData[] {
  if (!fs.existsSync(INFERENCE_DIR)) {
    return [];
  }
  
  try {
    const entries = fs.readdirSync(INFERENCE_DIR, { withFileTypes: true });
    const scenes: SceneData[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const sceneDir = path.join(INFERENCE_DIR, entry.name);
      const files = fs.readdirSync(sceneDir);

      let inputImage = '';
      let groundTruth = '';
      const models: ModelInfo[] = [];

      for (const file of files) {
        if (file.startsWith('.')) continue;

        if (file.startsWith('input')) {
          inputImage = file;
        } else if (file === 'gt.png') {
          groundTruth = file;
        } else if (file.endsWith('.png')) {
          // Any other PNG is a model prediction
          const name = path.basename(file, path.extname(file));
          models.push({ name, filename: file });
        }
      }

      if (inputImage && groundTruth) {
        models.sort((a, b) => a.name.localeCompare(b.name));
        scenes.push({
          id: entry.name,
          inputImage,
          groundTruth,
          models,
        });
      }
    }

    scenes.sort((a, b) => a.id.localeCompare(b.id));
    return scenes;
  } catch (e) {
    console.error("Error reading scenes:", e);
    return [];
  }
}

export function getSceneImagePath(sceneId: string, filename: string): string {
  return path.join(INFERENCE_DIR, sceneId, filename);
}
