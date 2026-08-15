# Inference Checker

Inference Checker is a local, dataset-agnostic viewer for semantic-segmentation artifacts. It overlays class-index masks on an input image, compares models side by side, highlights pixel-level disagreements, and computes per-scene class IoU, mIoU, and pixel accuracy.

It reads files from disk; it does not upload images or checkpoints. The full local artifact directory is gitignored by default so large datasets and model outputs are not accidentally committed.

## Inspect a portable bundle

The folder written by a compatible exporter is the portable, self-describing bundle. It contains `config.json`, scene folders, masks, images, and provenance. You can zip that folder, move it to another machine, unzip it unchanged, and inspect it without copying any data into this repository:

```bash
bun install
bun run inspect -- /absolute/or/relative/path/to/bundle
```

The command validates the bundle's root, config, scene layout, filenames, and provenance references, then launches the viewer at <http://localhost:3000>. PNG dimensions and IDs are validated lazily when scene metrics load. Press `Ctrl-C` to stop the local server.

For scripting or an existing Next.js process, set the same root explicitly:

```bash
INFERENCE_CHECKER_BUNDLE_ROOT=/path/to/bundle bun run dev
```

Relative environment-variable paths resolve from the repository directory. The default remains `public/inference_comparison/`. Bundle roots and artifacts may not be symbolic links, and artifact requests are restricted to validated files inside the selected root.

## Quick start

Requirements: [Bun](https://bun.sh/) and a modern browser.

```bash
bun install
bun run dev
```

Open <http://localhost:3000>. Put artifacts under `public/inference_comparison/` as described below. The app discovers new scenes when the page is reloaded.

Quality checks:

```bash
bun run test
bun run lint
bun run build
```

## Artifact contract

```text
public/inference_comparison/
├── config.json
├── scene-001/
│   ├── input.jpg
│   ├── gt.png
│   ├── model-a.png
│   ├── model-b.png
│   └── scene.json          # optional provenance
└── scene-002/
    ├── input.png
    ├── gt.png
    └── model-a.png
```

`config.json` is canonical. For existing RailSem19 exports, `rs19-config.json` remains supported as a fallback. If both exist, `config.json` wins. Always export the class list that matches the masks: a RailSem19-native mask and a Segmentary `rail_union` mask do not share the same class IDs.

Each complete scene must contain:

- Exactly one `input.jpg`, `input.jpeg`, `input.png`, or `input.webp` RGB image.
- `gt.png`, a PNG whose red channel stores a class index per pixel.
- Zero or more model PNGs using the same encoding. Every PNG other than `gt.png` is treated as a prediction.
- Matching width and height for ground truth and every prediction. The diff view also requires the input image to have the same dimensions.

Class indices are positions in `config.json.labels`: the first label is `0`, the second is `1`, and so on. Ground truth may contain `ignoreIndex` (default `255`). A prediction may contain the ignore index only where ground truth is ignored. Other unknown IDs are rejected and shown in the viewer instead of being silently excluded from metrics.

File and directory names must be simple names containing letters, digits, `.`, `_`, or `-`. Absolute paths, traversal such as `..`, and symbolic-link artifacts are rejected.

### Config schema

```json
{
  "title": "RailSem19 validation analysis",
  "dataset": "RailSem19",
  "description": "One-frame comparison of target-only and transfer models",
  "version": 1,
  "ignoreIndex": 255,
  "labels": [
    {
      "name": "road",
      "readable": "Road",
      "color": [128, 64, 128],
      "evaluate": true,
      "instances": false
    }
  ]
}
```

Required fields are `version` and a non-empty `labels` array. Every label requires a unique safe `name`, non-empty `readable` name, RGB `color`, and boolean `evaluate`. Classes with `evaluate: false` are treated as ignored when calculating metrics.

### Optional provenance

Add `scene.json` to make a comparison reproducible:

```json
{
  "title": "rs00033",
  "provenance": {
    "source": "RailSem19",
    "split": "validation",
    "frame": "rs00033",
    "notes": "Native-resolution sliding-window inference"
  },
  "models": {
    "rail-only.png": {
      "displayName": "EoMT DINOv3-L — Rail only",
      "model": "eomt_dinov3_large",
      "checkpoint": "sha256:...",
      "config": "configs/models/eomt_dinov3_large.yaml",
      "commit": "0123456789abcdef",
      "protocol": "640x640 window, 480px stride"
    }
  }
}
```

Supported provenance strings are `source`, `split`, `frame`, `model`, `checkpoint`, `config`, `commit`, `protocol`, and `notes`. A model key must exactly match an existing prediction filename. Metadata is displayed in a collapsible panel and is never used to locate files.

## Metric definitions

- **Scene mIoU (GT-present)** is the primary single-frame comparison metric. Its denominator is the fixed set of evaluated classes present in that frame's ground truth. A GT-present class that the model never predicts receives IoU `0`.
- **Union mIoU** is the conventional mean over evaluated classes present in either ground truth or prediction. It is shown separately because a hallucinated, GT-absent class changes this denominator and can make rankings between models misleading on a single image.
- **Pixel accuracy** is correct pixels divided by evaluated ground-truth pixels.
- **Prediction-only classes** are reported explicitly with their pixel counts.

These are per-scene diagnostics, not replacements for dataset-level metrics. Use aggregate evaluation over the full validation split for model ranking.

## Data safety and version control

`public/inference_comparison` is ignored in `.gitignore`. Existing tiny demonstration files may remain tracked, but newly generated scenes, masks, source images, checkpoints, event logs, and large inference outputs should stay local. Check `git status --short` before every commit and do not force-add artifacts unless their size, license, and privacy have been reviewed.

## Export from Segmentary

Use Segmentary's `segmentary-scene` command instead of reimplementing preprocessing or inference in this repository. It loads exact raw or EMA checkpoint weights, uses Segmentary's native evaluation transform and sliding-window protocol, exports canonical masks, and records hashes/provenance. Run it once per checkpoint with the same frame key, output root, and distinct model name:

```bash
segmentary-scene \
  configs/base.yaml configs/models/MODEL.yaml PATH/TO/resolved.yaml \
  --ckpt PATH/TO/best.ckpt --ema \
  --name rail-only \
  --dataset railsem19 --root /data/izadia1/datasets/railsem19 \
  --mapping railsem19 --split val \
  --split-file splits/railsem19_seed0.json \
  --frame-key rs04890 --device cuda:0 \
  --out /path/to/inference-checker/public/inference_comparison
```

Repeat with `--name city-to-rail` and the transfer run's exact resolved config/checkpoint. The viewer understands the exporter's canonical `taxonomy.classes` config and rich `predictions` provenance directly. Do not replace its generated `config.json` with native `rs19-config.json`; the ID spaces differ from class 3 onward.

## Current limitations

- Masks are decoded from the PNG red channel, so palette or grayscale PNGs must preserve the intended numeric index in that channel.
- Metrics are computed lazily for the selected scene in the Next.js server process and are not persisted.
- The viewer validates mask pairs when metrics load; it does not replace a full dataset-integrity audit.
- The repository does not bundle a training framework. Exporters should write this explicit contract and include their exact taxonomy in `config.json`.
- The current launcher is a Bun repository command. A future release can wrap the same bundle contract in an `npx` package or Docker image without changing bundle contents.
