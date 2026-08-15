import { spawn } from "node:child_process";
import path from "node:path";
import {
  BUNDLE_ROOT_ENV,
  getAllScenes,
  getConfig,
  validateBundleRoot,
} from "../lib/data";

export interface BundleSummary {
  root: string;
  title: string;
  classCount: number;
  sceneCount: number;
  modelCount: number;
}

export function validateBundle(bundleArgument: string, cwd = process.cwd()): BundleSummary {
  if (bundleArgument.trim() === "") throw new Error("Bundle path may not be empty");
  const root = validateBundleRoot(path.resolve(cwd, bundleArgument));
  const config = getConfig(root);
  const scenes = getAllScenes(root);
  if (scenes.length === 0) {
    throw new Error(`Bundle contains no complete scenes: ${root}`);
  }
  return {
    root,
    title: config.title || config.dataset || "Semantic Segmentation Analysis",
    classCount: config.labels.length,
    sceneCount: scenes.length,
    modelCount: scenes.reduce((total, scene) => total + scene.models.length, 0),
  };
}

function usage(): string {
  return "Usage: bun run inspect -- /absolute/or/relative/bundle";
}

async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    console.log(usage());
    return 0;
  }
  if (args.length !== 1) throw new Error(usage());

  const bundle = validateBundle(args[0]);
  console.log(
    `Validated ${bundle.title}: ${bundle.sceneCount} scene(s), ` +
      `${bundle.modelCount} prediction(s), ${bundle.classCount} classes`,
  );
  console.log(`Bundle: ${bundle.root}`);
  console.log("Opening viewer at http://localhost:3000");

  const projectRoot = path.resolve(import.meta.dir, "..");
  const child = spawn(process.execPath, ["run", "dev"], {
    cwd: projectRoot,
    env: { ...process.env, [BUNDLE_ROOT_ENV]: bundle.root },
    stdio: "inherit",
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => child.kill(signal));
  }
  return await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) resolve(128 + (signal === "SIGINT" ? 2 : 15));
      else resolve(code ?? 1);
    });
  });
}

if (import.meta.main) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(`Could not inspect bundle: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
