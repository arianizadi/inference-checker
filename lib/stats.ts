import fs from "fs";
import { PNG } from "pngjs";
import {
  getConfig,
  getSceneImagePath,
  resolveInferenceRoot,
  type SegmentationConfig,
} from "./data";

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
  /** Mean over evaluated classes that are present in this scene's ground truth. */
  mIoU: number;
  /** Conventional mean over evaluated classes with GT or predicted pixels. */
  unionMIoU: number;
  pixelAccuracy: number;
  evaluatedPixels: number;
  ignoredPixels: number;
  gtPresentClassCount: number;
  predictionOnlyClasses: ClassIoU[];
  classIoUs: ClassIoU[];
}

export interface IndexMask {
  indices: Uint8Array;
  width: number;
  height: number;
}

export interface IndexMaskHeader {
  width: number;
  height: number;
  fileBytes: number;
}

export const MASK_LIMITS = {
  compressedBytes: 32 * 1024 * 1024,
  pixels: 16 * 1024 * 1024,
  dimension: 16_384,
} as const;

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

function validatePngHeader(data: Buffer, filePath: string): { width: number; height: number } {
  if (data.length < 29 || !PNG_SIGNATURE.every((byte, index) => data[index] === byte)) {
    throw new Error(`Index-mask file ${filePath} has no valid PNG signature/IHDR header`);
  }
  if (data.readUInt32BE(8) !== 13 || data.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error(`Index-mask file ${filePath} must begin with a standard PNG IHDR chunk`);
  }
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  const depth = data[24];
  const colorType = data[25];
  if (depth !== 8 || colorType !== 0) {
    throw new Error(
      `Index-mask PNG ${filePath} must be 8-bit grayscale (PNG color type 0); ` +
      `received color type ${colorType}, bit depth ${depth}`,
    );
  }
  if (data[26] !== 0 || data[27] !== 0) {
    throw new Error(
      `Index-mask PNG ${filePath} must use standard PNG compression and filtering`,
    );
  }
  if (data[28] !== 0) {
    throw new Error(
      `Index-mask PNG ${filePath} must be non-interlaced (IHDR interlace method 0)`,
    );
  }
  if (
    width === 0 ||
    height === 0 ||
    width > MASK_LIMITS.dimension ||
    height > MASK_LIMITS.dimension ||
    width * height > MASK_LIMITS.pixels
  ) {
    throw new Error(
      `Index-mask PNG ${filePath} dimensions ${width}x${height} exceed limit ` +
        `${MASK_LIMITS.dimension} per side / ${MASK_LIMITS.pixels.toLocaleString()} pixels`,
    );
  }
  return { width, height };
}

export function readMaskHeader(filePath: string): IndexMaskHeader {
  const fileBytes = fs.statSync(filePath).size;
  if (fileBytes > MASK_LIMITS.compressedBytes) {
    throw new Error(
      `Index-mask PNG ${filePath} is ${fileBytes.toLocaleString()} bytes; compressed limit is ` +
        `${MASK_LIMITS.compressedBytes.toLocaleString()} bytes`,
    );
  }
  const headerBytes = Buffer.alloc(29);
  const descriptor = fs.openSync(filePath, "r");
  let bytesRead: number;
  try {
    bytesRead = fs.readSync(descriptor, headerBytes, 0, headerBytes.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  const header = validatePngHeader(headerBytes.subarray(0, bytesRead), filePath);
  return { ...header, fileBytes };
}

export function readMaskIndices(
  filePath: string,
  requiredHeader?: Pick<IndexMaskHeader, "width" | "height">,
): IndexMask {
  const expectedHeader = readMaskHeader(filePath);
  if (
    requiredHeader &&
    (expectedHeader.width !== requiredHeader.width ||
      expectedHeader.height !== requiredHeader.height)
  ) {
    throw new Error(
      `Index-mask dimensions changed before decode for ${filePath}: expected ` +
        `${requiredHeader.width}x${requiredHeader.height}, received ` +
        `${expectedHeader.width}x${expectedHeader.height}`,
    );
  }
  const data = fs.readFileSync(filePath);
  const header = validatePngHeader(data, filePath);
  if (
    data.length !== expectedHeader.fileBytes ||
    header.width !== expectedHeader.width ||
    header.height !== expectedHeader.height ||
    (requiredHeader !== undefined &&
      (header.width !== requiredHeader.width || header.height !== requiredHeader.height))
  ) {
    throw new Error(`Index-mask file changed while it was being read: ${filePath}`);
  }
  let png: ReturnType<typeof PNG.sync.read>;
  try {
    png = PNG.sync.read(data);
  } catch (error) {
    throw new Error(
      `Could not decode index-mask PNG ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    png.colorType !== 0 ||
    png.depth !== 8 ||
    png.width !== header.width ||
    png.height !== header.height
  ) {
    throw new Error(`Decoded index-mask metadata changed unexpectedly for ${filePath}`);
  }
  const indices = new Uint8Array(png.width * png.height);
  for (let i = 0; i < indices.length; i++) indices[i] = png.data[i * 4];
  return { indices, width: png.width, height: png.height };
}

export function computeStatsFromMasks(
  gt: IndexMask,
  pred: IndexMask,
  modelName: string,
  config: SegmentationConfig,
): ModelStats {
  if (gt.width !== pred.width || gt.height !== pred.height) {
    throw new Error(
      `Size mismatch for ${modelName}: GT(${gt.width}x${gt.height}) vs prediction(${pred.width}x${pred.height})`,
    );
  }
  const expectedPixels = gt.width * gt.height;
  if (gt.indices.length !== expectedPixels || pred.indices.length !== expectedPixels) {
    throw new Error(`Decoded mask length does not match dimensions for ${modelName}`);
  }

  const numClasses = config.labels.length;
  const { ignoreIndex } = config;
  const intersection = new Float64Array(numClasses);
  const gtCount = new Float64Array(numClasses);
  const predCount = new Float64Array(numClasses);
  let correctPixels = 0;
  let evaluatedPixels = 0;
  let ignoredPixels = 0;

  for (let i = 0; i < expectedPixels; i++) {
    const gtIdx = gt.indices[i];
    const predIdx = pred.indices[i];

    if (gtIdx !== ignoreIndex && gtIdx >= numClasses) {
      throw new Error(`Ground truth contains invalid class ID ${gtIdx} at pixel ${i}`);
    }
    if (predIdx !== ignoreIndex && predIdx >= numClasses) {
      throw new Error(
        `${modelName} contains invalid prediction class ID ${predIdx} at pixel ${i}`,
      );
    }
    if (gtIdx === ignoreIndex || !config.labels[gtIdx].evaluate) {
      ignoredPixels++;
      continue;
    }
    if (predIdx === ignoreIndex) {
      throw new Error(
        `${modelName} predicts ignore index ${ignoreIndex} on evaluated pixel ${i}`,
      );
    }

    evaluatedPixels++;
    gtCount[gtIdx]++;
    predCount[predIdx]++;
    if (gtIdx === predIdx) {
      correctPixels++;
      intersection[gtIdx]++;
    }
  }

  if (evaluatedPixels === 0) {
    throw new Error("Ground truth contains no evaluated pixels");
  }

  let gtPresentIoUTotal = 0;
  let gtPresentClassCount = 0;
  let unionIoUTotal = 0;
  let unionClassCount = 0;
  const classIoUs: ClassIoU[] = [];
  const predictionOnlyClasses: ClassIoU[] = [];
  for (let classIndex = 0; classIndex < numClasses; classIndex++) {
    const label = config.labels[classIndex];
    if (!label.evaluate) continue;
    const classIntersection = intersection[classIndex];
    const union = gtCount[classIndex] + predCount[classIndex] - classIntersection;
    if (union === 0) continue;

    const iou = (classIntersection / union) * 100;
    unionIoUTotal += iou;
    unionClassCount++;
    if (gtCount[classIndex] > 0) {
      gtPresentIoUTotal += iou;
      gtPresentClassCount++;
    }
    const classStats = {
      classIndex,
      name: label.name,
      readable: label.readable,
      iou,
      intersection: classIntersection,
      union,
      gtPixels: gtCount[classIndex],
      predPixels: predCount[classIndex],
      color: label.color,
    };
    classIoUs.push(classStats);
    if (gtCount[classIndex] === 0 && predCount[classIndex] > 0) {
      predictionOnlyClasses.push(classStats);
    }
  }

  if (gtPresentClassCount === 0) {
    throw new Error("No evaluated class is present in the ground truth");
  }
  classIoUs.sort((a, b) => b.iou - a.iou);
  predictionOnlyClasses.sort((a, b) => b.predPixels - a.predPixels);
  return {
    modelName,
    mIoU: gtPresentIoUTotal / gtPresentClassCount,
    unionMIoU: unionIoUTotal / unionClassCount,
    pixelAccuracy: (correctPixels / evaluatedPixels) * 100,
    evaluatedPixels,
    ignoredPixels,
    gtPresentClassCount,
    predictionOnlyClasses,
    classIoUs,
  };
}

export function computeStats(
  sceneId: string,
  gtFilename: string,
  modelFilename: string,
  modelName: string,
  root = resolveInferenceRoot(),
  config = getConfig(root),
): ModelStats {
  const gt = readMaskIndices(getSceneImagePath(sceneId, gtFilename, root));
  const pred = readMaskIndices(getSceneImagePath(sceneId, modelFilename, root));
  try {
    return computeStatsFromMasks(gt, pred, modelName, config);
  } catch (error) {
    throw new Error(
      `Invalid artifacts for ${modelName} in ${sceneId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
