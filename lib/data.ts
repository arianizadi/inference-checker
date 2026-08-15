import fs from "fs";
import path from "path";

export interface SegmentationClass {
  color: [number, number, number];
  evaluate: boolean;
  instances?: boolean;
  name: string;
  readable: string;
}

export interface SegmentationConfig {
  labels: SegmentationClass[];
  version: number | string;
  title?: string;
  dataset?: string;
  description?: string;
  ignoreIndex: number;
}

export interface ArtifactProvenance {
  source?: string;
  split?: string;
  frame?: string;
  model?: string;
  checkpoint?: string;
  config?: string;
  commit?: string;
  protocol?: string;
  notes?: string;
}

interface SceneManifest {
  title?: string;
  provenance?: ArtifactProvenance;
  models?: Record<string, ArtifactProvenance & { displayName?: string }>;
}

export interface ModelInfo {
  name: string;
  filename: string;
  provenance?: ArtifactProvenance;
}

export interface SceneData {
  id: string;
  title?: string;
  inputImage: string;
  groundTruth: string;
  models: ModelInfo[];
  provenance?: ArtifactProvenance;
}

export interface BundleIndex {
  root: string;
  generation: number;
  config: SegmentationConfig;
  scenes: SceneData[];
  scenesById: ReadonlyMap<string, SceneData>;
}

export const BUNDLE_ROOT_ENV = "INFERENCE_CHECKER_BUNDLE_ROOT";
export const INFERENCE_DIR = path.join(
  process.cwd(),
  "public",
  "inference_comparison",
);

const CONFIG_FILENAMES = ["config.json", "rs19-config.json"] as const;
export const BUNDLE_LIMITS = {
  configBytes: 1024 * 1024,
  sceneManifestBytes: 2 * 1024 * 1024,
  allSceneManifestBytes: 64 * 1024 * 1024,
  scenes: 10_000,
  filesPerScene: 256,
  allSceneFiles: 100_000,
} as const;
const MAX_CACHED_BUNDLE_ROOTS = 4;
const bundleIndexCache = new Map<string, BundleIndex>();
let nextBundleGeneration = 1;
const SAFE_COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const INPUT_FILENAME = /^input\.(?:jpe?g|png|webp)$/i;
const PROVENANCE_FIELDS = [
  "source",
  "split",
  "frame",
  "model",
  "checkpoint",
  "config",
  "commit",
  "protocol",
  "notes",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeFile(filePath: string): string {
  return path.relative(process.cwd(), filePath) || path.basename(filePath);
}

function readJsonDocument(filePath: string, maxBytes: number): unknown {
  const size = fs.statSync(filePath).size;
  if (size > maxBytes) {
    throw new Error(
      `${describeFile(filePath)} is ${size.toLocaleString()} bytes; limit is ${maxBytes.toLocaleString()} bytes`,
    );
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function resolveInferenceRoot(
  configuredRoot = process.env[BUNDLE_ROOT_ENV],
  cwd = process.cwd(),
): string {
  if (configuredRoot === undefined || configuredRoot.trim() === "") {
    return path.resolve(cwd, "public", "inference_comparison");
  }
  return path.resolve(cwd, configuredRoot);
}

export function validateBundleRoot(root: string): string {
  const resolved = path.resolve(root);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Bundle directory does not exist: ${resolved}`);
  }
  const stats = fs.lstatSync(resolved);
  if (stats.isSymbolicLink()) {
    throw new Error(`Bundle directory may not be a symbolic link: ${resolved}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`Bundle path is not a directory: ${resolved}`);
  }
  return resolved;
}

export function assertSafePathComponent(value: string, field: string): void {
  if (!SAFE_COMPONENT.test(value) || value === "." || value === "..") {
    throw new Error(
      `${field} must be a single safe filename component; received ${JSON.stringify(value)}`,
    );
  }
}

export function resolveArtifactPath(
  root: string,
  ...components: string[]
): string {
  for (const [index, component] of components.entries()) {
    assertSafePathComponent(component, `path component ${index + 1}`);
  }

  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, ...components);
  const relative = path.relative(resolvedRoot, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Artifact path escapes the inference data directory");
  }

  if (fs.existsSync(candidate)) {
    const stats = fs.lstatSync(candidate);
    if (stats.isSymbolicLink()) {
      throw new Error(`Symbolic links are not allowed in inference artifacts: ${candidate}`);
    }
    if (fs.existsSync(resolvedRoot)) {
      const realRoot = fs.realpathSync(resolvedRoot);
      const realCandidate = fs.realpathSync(candidate);
      const realRelative = path.relative(realRoot, realCandidate);
      if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
        throw new Error("Artifact path resolves outside the inference data directory");
      }
    }
  }

  return candidate;
}

function validateProvenance(
  value: unknown,
  field: string,
): ArtifactProvenance | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`${field} must be an object`);

  const result: ArtifactProvenance = {};
  for (const key of PROVENANCE_FIELDS) {
    const item = value[key];
    if (item === undefined) continue;
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new Error(`${field}.${key} must be a non-empty string`);
    }
    result[key] = item;
  }
  return result;
}

function compactProvenance(
  value: ArtifactProvenance,
): ArtifactProvenance | undefined {
  const result: ArtifactProvenance = {};
  for (const key of PROVENANCE_FIELDS) {
    if (value[key] !== undefined) result[key] = value[key];
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function validateConfig(value: unknown): SegmentationConfig {
  if (!isRecord(value)) throw new Error("Config must be a JSON object");
  if (isRecord(value.taxonomy)) {
    const taxonomy = value.taxonomy;
    if (!Array.isArray(taxonomy.classes)) {
      throw new Error("Config taxonomy.classes must be an array");
    }
    value = {
      version: value.schema_version ?? 1,
      title: taxonomy.name,
      dataset: taxonomy.name,
      description: taxonomy.description,
      ignoreIndex: taxonomy.ignore_index,
      labels: taxonomy.classes.map((item, index) => {
        if (!isRecord(item)) return item;
        if (item.id !== index) {
          throw new Error(
            `taxonomy.classes[${index}].id must be ${index}; class IDs must be contiguous`,
          );
        }
        return {
          name: item.name,
          readable: item.readable ?? item.name,
          color: item.color,
          evaluate: item.evaluate,
          instances: item.instances,
        };
      }),
    };
  }
  if (!isRecord(value)) throw new Error("Config must normalize to a JSON object");
  if (!Array.isArray(value.labels) || value.labels.length === 0) {
    throw new Error("Config labels must be a non-empty array");
  }
  if (value.labels.length > 255) {
    throw new Error("Index-mask artifacts support at most 255 classes");
  }

  const names = new Set<string>();
  const labels = value.labels.map((raw, index): SegmentationClass => {
    if (!isRecord(raw)) throw new Error(`labels[${index}] must be an object`);
    if (typeof raw.name !== "string" || !SAFE_COMPONENT.test(raw.name)) {
      throw new Error(`labels[${index}].name must be a safe non-empty identifier`);
    }
    if (names.has(raw.name)) throw new Error(`Duplicate class name: ${raw.name}`);
    names.add(raw.name);
    if (typeof raw.readable !== "string" || raw.readable.trim().length === 0) {
      throw new Error(`labels[${index}].readable must be a non-empty string`);
    }
    if (typeof raw.evaluate !== "boolean") {
      throw new Error(`labels[${index}].evaluate must be a boolean`);
    }
    if (raw.instances !== undefined && typeof raw.instances !== "boolean") {
      throw new Error(`labels[${index}].instances must be a boolean when present`);
    }
    if (
      !Array.isArray(raw.color) ||
      raw.color.length !== 3 ||
      raw.color.some(
        (channel) =>
          !Number.isInteger(channel) || Number(channel) < 0 || Number(channel) > 255,
      )
    ) {
      throw new Error(`labels[${index}].color must contain three integers from 0 to 255`);
    }

    return {
      name: raw.name,
      readable: raw.readable,
      evaluate: raw.evaluate,
      instances: raw.instances as boolean | undefined,
      color: raw.color as [number, number, number],
    };
  });

  if (typeof value.version !== "number" && typeof value.version !== "string") {
    throw new Error("Config version must be a number or string");
  }
  for (const field of ["title", "dataset", "description"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "string") {
      throw new Error(`Config ${field} must be a string when present`);
    }
  }

  const ignoreIndex = value.ignoreIndex ?? 255;
  if (
    typeof ignoreIndex !== "number" ||
    !Number.isInteger(ignoreIndex) ||
    ignoreIndex < 0 ||
    ignoreIndex > 255
  ) {
    throw new Error("Config ignoreIndex must be an integer from 0 to 255");
  }
  if (ignoreIndex < labels.length) {
    throw new Error("Config ignoreIndex must not overlap a class index");
  }

  return {
    labels,
    version: value.version,
    title: value.title as string | undefined,
    dataset: value.dataset as string | undefined,
    description: value.description as string | undefined,
    ignoreIndex,
  };
}

export function getConfig(root = resolveInferenceRoot()): SegmentationConfig {
  const configName = CONFIG_FILENAMES.find((name) =>
    fs.existsSync(resolveArtifactPath(root, name)),
  );
  if (!configName) {
    throw new Error(
      `Missing config.json (legacy rs19-config.json is also supported) in ${describeFile(root)}`,
    );
  }

  const configPath = resolveArtifactPath(root, configName);
  let parsed: unknown;
  try {
    parsed = readJsonDocument(configPath, BUNDLE_LIMITS.configBytes);
  } catch (error) {
    throw new Error(
      `Could not parse ${describeFile(configPath)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    return validateConfig(parsed);
  } catch (error) {
    throw new Error(
      `Invalid ${describeFile(configPath)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function readSceneManifest(sceneDir: string): SceneManifest | undefined {
  const manifestPath = resolveArtifactPath(sceneDir, "scene.json");
  if (!fs.existsSync(manifestPath)) return undefined;

  let value: unknown;
  try {
    value = readJsonDocument(manifestPath, BUNDLE_LIMITS.sceneManifestBytes);
  } catch (error) {
    throw new Error(
      `Could not parse ${describeFile(manifestPath)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(value)) throw new Error(`${describeFile(manifestPath)} must be an object`);
  if (value.title !== undefined && typeof value.title !== "string") {
    throw new Error(`${describeFile(manifestPath)} title must be a string`);
  }
  if (value.models !== undefined && !isRecord(value.models)) {
    throw new Error(`${describeFile(manifestPath)} models must be an object`);
  }

  const models: SceneManifest["models"] = {};
  if (isRecord(value.models)) {
    for (const [filename, rawModel] of Object.entries(value.models)) {
      assertSafePathComponent(filename, "scene model filename");
      if (!filename.toLowerCase().endsWith(".png")) {
        throw new Error(`Scene model metadata key must name a PNG: ${filename}`);
      }
      if (!isRecord(rawModel)) throw new Error(`Metadata for ${filename} must be an object`);
      if (rawModel.displayName !== undefined && typeof rawModel.displayName !== "string") {
        throw new Error(`Metadata displayName for ${filename} must be a string`);
      }
      models[filename] = {
        ...validateProvenance(rawModel, `models.${filename}`),
        displayName: rawModel.displayName as string | undefined,
      };
    }
  }

  // Segmentary's native exporter records richer, nested provenance. Normalize it
  // to the viewer's safe display-only strings while retaining its exact hashes.
  if (value.predictions !== undefined) {
    if (!isRecord(value.predictions)) {
      throw new Error(`${describeFile(manifestPath)} predictions must be an object`);
    }
    for (const [predictionName, rawPrediction] of Object.entries(value.predictions)) {
      if (!isRecord(rawPrediction) || typeof rawPrediction.file !== "string") {
        throw new Error(`Prediction ${predictionName} must contain a file string`);
      }
      assertSafePathComponent(rawPrediction.file, `prediction ${predictionName} file`);
      if (!rawPrediction.file.endsWith(".png")) {
        throw new Error(`Prediction ${predictionName} file must be a PNG`);
      }
      const checkpoint = isRecord(rawPrediction.checkpoint)
        ? rawPrediction.checkpoint
        : undefined;
      const predictionConfig = isRecord(rawPrediction.config)
        ? rawPrediction.config
        : undefined;
      const segmentary = isRecord(rawPrediction.segmentary)
        ? rawPrediction.segmentary
        : undefined;
      const protocol = isRecord(rawPrediction.protocol)
        ? rawPrediction.protocol
        : undefined;
      const checkpointText = [checkpoint?.file, checkpoint?.sha256]
        .filter((item): item is string => typeof item === "string")
        .join(" · sha256:");
      const configText = [predictionConfig?.hash, predictionConfig?.sha256]
        .filter((item): item is string => typeof item === "string")
        .join(" · sha256:");
      const gitSha = typeof segmentary?.git_sha === "string" ? segmentary.git_sha : undefined;
      const dirty = segmentary?.git_dirty === true ? " (dirty)" : "";
      models[rawPrediction.file] = {
        displayName:
          typeof rawPrediction.name === "string" ? rawPrediction.name : predictionName,
        model: predictionName,
        checkpoint: checkpointText || undefined,
        config: configText || undefined,
        commit: gitSha ? `${gitSha}${dirty}` : undefined,
        protocol: protocol ? JSON.stringify(protocol) : undefined,
        notes:
          typeof rawPrediction.weights === "string"
            ? `weights=${rawPrediction.weights}`
            : undefined,
      };
    }
  }

  const exportedProvenance: ArtifactProvenance = {
    source: typeof value.dataset === "string" ? value.dataset : undefined,
    split: typeof value.split === "string" ? value.split : undefined,
    frame: typeof value.frame_key === "string" ? value.frame_key : undefined,
  };
  const hasExportedProvenance = Object.values(exportedProvenance).some(Boolean);

  return {
    title: value.title as string | undefined,
    provenance:
      validateProvenance(value.provenance, "scene provenance") ??
      (hasExportedProvenance ? exportedProvenance : undefined),
    models,
  };
}

/** Discover validated scene metadata without decoding the potentially large PNG masks. */
export function getAllScenes(root = resolveInferenceRoot()): SceneData[] {
  if (!fs.existsSync(root)) return [];
  const rootStats = fs.lstatSync(root);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error(`${describeFile(root)} must be a real directory, not a symbolic link`);
  }

  const rootEntries = fs.readdirSync(root, { withFileTypes: true });
  if (rootEntries.length > BUNDLE_LIMITS.scenes + CONFIG_FILENAMES.length) {
    throw new Error(`Bundle contains too many root entries; limit is ${BUNDLE_LIMITS.scenes}`);
  }

  const scenes: SceneData[] = [];
  let allSceneFiles = 0;
  let allSceneManifestBytes = 0;
  for (const entry of rootEntries) {
    // Portable archives and staging workflows commonly add unrelated siblings.
    // Never follow a root symlink, and only validate a real directory as a scene
    // after its direct entries contain both canonical scene markers.
    if (
      entry.isSymbolicLink() ||
      !entry.isDirectory() ||
      entry.name.startsWith(".") ||
      entry.name === "__MACOSX"
    ) continue;

    const sceneDir = path.join(root, entry.name);

    const files = fs
      .readdirSync(sceneDir, { withFileTypes: true })
      .filter((file) => !file.name.startsWith("."));
    const inputEntries = files.filter((file) => INPUT_FILENAME.test(file.name));
    const groundTruthEntry = files.find((file) => file.name === "gt.png");

    // A directory without the canonical pair is not a scene. This allows zip
    // metadata and incomplete staging siblings without weakening validation of
    // any directory that presents itself as an actual scene.
    if (inputEntries.length === 0 || !groundTruthEntry) continue;

    assertSafePathComponent(entry.name, "scene directory name");
    if (files.length > BUNDLE_LIMITS.filesPerScene) {
      throw new Error(
        `Scene ${entry.name} contains ${files.length} files; limit is ${BUNDLE_LIMITS.filesPerScene}`,
      );
    }
    allSceneFiles += files.length;
    if (allSceneFiles > BUNDLE_LIMITS.allSceneFiles) {
      throw new Error(
        `Bundle contains more than ${BUNDLE_LIMITS.allSceneFiles.toLocaleString()} scene files`,
      );
    }
    const linkedFile = files.find((file) => file.isSymbolicLink());
    if (linkedFile) {
      throw new Error(
        `Symbolic links are not allowed in scene ${entry.name}: ${linkedFile.name}`,
      );
    }
    const manifestEntry = files.find((file) => file.name === "scene.json");
    if (manifestEntry) {
      allSceneManifestBytes += fs.statSync(path.join(sceneDir, manifestEntry.name)).size;
      if (allSceneManifestBytes > BUNDLE_LIMITS.allSceneManifestBytes) {
        throw new Error(
          `Bundle scene metadata exceeds ${BUNDLE_LIMITS.allSceneManifestBytes.toLocaleString()} total bytes`,
        );
      }
    }
    const inputFiles = files.filter((file) => file.isFile() && INPUT_FILENAME.test(file.name));
    const groundTruth = files.find((file) => file.isFile() && file.name === "gt.png");

    if (!groundTruth) {
      throw new Error(`Scene ${entry.name} ground truth must be a regular file`);
    }
    if (inputFiles.length !== 1) {
      throw new Error(`Scene ${entry.name} must contain exactly one input image`);
    }

    const manifest = readSceneManifest(sceneDir);
    const inputFilename = inputFiles[0].name;
    const modelFiles = files.filter(
      (file) =>
        file.isFile() &&
        file.name.endsWith(".png") &&
        file.name !== "gt.png" &&
        file.name !== inputFilename,
    );
    const models = modelFiles.map((file): ModelInfo => {
      const metadata = manifest?.models?.[file.name];
      return {
        name: metadata?.displayName || path.basename(file.name, path.extname(file.name)),
        filename: file.name,
        provenance: metadata ? compactProvenance(metadata) : undefined,
      };
    });

    for (const metadataFile of Object.keys(manifest?.models ?? {})) {
      if (!modelFiles.some((file) => file.name === metadataFile)) {
        throw new Error(
          `Scene ${entry.name} has metadata for missing model artifact ${metadataFile}`,
        );
      }
    }

    models.sort((a, b) => a.name.localeCompare(b.name));
    scenes.push({
      id: entry.name,
      title: manifest?.title,
      inputImage: inputFilename,
      groundTruth: groundTruth.name,
      models,
      provenance: manifest?.provenance,
    });
  }

  scenes.sort((a, b) => a.id.localeCompare(b.id));
  return scenes;
}

/**
 * Build a validated, immutable process-lifetime bundle index.
 *
 * Portable bundles are treated as snapshots. Restart the viewer (or explicitly
 * clear this cache in a test/tool) after changing files on disk. Keeping a small
 * bounded root cache makes scene lookup O(1) without watching thousands of files.
 */
export function getBundleIndex(root = resolveInferenceRoot()): BundleIndex {
  const resolvedRoot = validateBundleRoot(root);
  const cached = bundleIndexCache.get(resolvedRoot);
  if (cached) {
    bundleIndexCache.delete(resolvedRoot);
    bundleIndexCache.set(resolvedRoot, cached);
    return cached;
  }

  const config = getConfig(resolvedRoot);
  const scenes = getAllScenes(resolvedRoot);
  const index: BundleIndex = {
    root: resolvedRoot,
    generation: nextBundleGeneration++,
    config,
    scenes,
    scenesById: new Map(scenes.map((scene) => [scene.id, scene])),
  };
  bundleIndexCache.set(resolvedRoot, index);
  while (bundleIndexCache.size > MAX_CACHED_BUNDLE_ROOTS) {
    const oldest = bundleIndexCache.keys().next().value;
    if (oldest === undefined) break;
    bundleIndexCache.delete(oldest);
  }
  return index;
}

export function clearBundleIndexCache(): void {
  bundleIndexCache.clear();
}

export function bundleIndexCacheEntries(): number {
  return bundleIndexCache.size;
}

export function getSceneImagePath(
  sceneId: string,
  filename: string,
  root = resolveInferenceRoot(),
): string {
  const filePath = resolveArtifactPath(root, sceneId, filename);
  if (!fs.existsSync(filePath) || !fs.lstatSync(filePath).isFile()) {
    throw new Error(`Artifact does not exist or is not a file: ${sceneId}/${filename}`);
  }
  return filePath;
}
