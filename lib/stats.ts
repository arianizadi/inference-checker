import fs from 'fs';
import { PNG } from 'pngjs';
import { getConfig, getSceneImagePath } from './data';

export interface ClassIoU {
  classIndex: number;
  name: string;
  readable: string;
  iou: number;
  intersection: number;
  union: number;
  gtPixels: number;
  predPixels: number;
  color: [number, number, number];
}

export interface ModelStats {
  modelName: string;
  mIoU: number;
  pixelAccuracy: number;
  classIoUs: ClassIoU[];
}

const IGNORE_INDEX = 255;

function readMaskIndices(filePath: string): { indices: Uint8Array; width: number; height: number } {
  const data = fs.readFileSync(filePath);
  const png = PNG.sync.read(data);
  const indices = new Uint8Array(png.width * png.height);

  for (let i = 0; i < indices.length; i++) {
    indices[i] = png.data[i * 4]; // R channel = class index
  }

  return { indices, width: png.width, height: png.height };
}

export function computeStats(sceneId: string, gtFilename: string, modelFilename: string, modelName: string): ModelStats {
  const config = getConfig();
  const numClasses = config.labels.length;

  const gt = readMaskIndices(getSceneImagePath(sceneId, gtFilename));
  const pred = readMaskIndices(getSceneImagePath(sceneId, modelFilename));

  if (gt.width !== pred.width || gt.height !== pred.height) {
    throw new Error(
      `Size mismatch for ${modelName} in ${sceneId}: GT(${gt.width}x${gt.height}) vs Model(${pred.width}x${pred.height})`
    );
  }

  const intersection = new Float64Array(numClasses);
  const gtCount = new Float64Array(numClasses);
  const totalPredCount = new Float64Array(numClasses);

  let correctPixels = 0;
  let totalEvaluatedPixels = 0;

  for (let i = 0; i < gt.indices.length; i++) {
    const gtIdx = gt.indices[i];
    const prIdx = pred.indices[i];

    if (gtIdx === IGNORE_INDEX || gtIdx >= numClasses) continue;

    totalEvaluatedPixels++;
    gtCount[gtIdx]++;

    if (prIdx < numClasses) {
      totalPredCount[prIdx]++;
    }

    if (gtIdx === prIdx) {
      correctPixels++;
      intersection[gtIdx]++;
    }
  }

  const pixelAccuracy = totalEvaluatedPixels > 0 ? (correctPixels / totalEvaluatedPixels) * 100 : 0;

  let totalIou = 0;
  let validClasses = 0;
  const classIoUs: ClassIoU[] = [];

  for (let c = 0; c < numClasses; c++) {
    const label = config.labels[c];
    if (!label.evaluate) continue;

    const inter = intersection[c];
    const union = gtCount[c] + totalPredCount[c] - inter;

    if (union === 0) continue;

    const iou = (inter / union) * 100;
    totalIou += iou;
    validClasses++;

    classIoUs.push({
      classIndex: c,
      name: label.name,
      readable: label.readable,
      iou,
      intersection: inter,
      union,
      gtPixels: gtCount[c],
      predPixels: totalPredCount[c],
      color: label.color,
    });
  }

  const mIoU = validClasses > 0 ? totalIou / validClasses : 0;
  classIoUs.sort((a, b) => b.iou - a.iou);

  return { modelName, mIoU, pixelAccuracy, classIoUs };
}
