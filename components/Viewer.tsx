"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Activity, LayoutTemplate, ChevronLeft, ChevronRight, Loader2, HelpCircle, X, AlertTriangle } from "lucide-react";
import MaskCanvas from "./MaskCanvas";
import DiffCanvas from "./DiffCanvas";
import ClassLegend from "./ClassLegend";
import HoverTooltip from "./HoverTooltip";
import DiffTooltip from "./DiffTooltip";
import ModelSelector, { ViewMode, ModelOption } from "./ModelSelector";
import type { ArtifactProvenance, SegmentationConfig } from "../lib/data";
import type { ModelStats } from "../lib/stats";

interface ViewerModel {
  name: string;
  filename: string;
  provenance?: ArtifactProvenance;
}

interface SceneInfo {
  id: string;
  title?: string;
  inputImage: string;
  groundTruth: string;
  models: ViewerModel[];
  provenance?: ArtifactProvenance;
}

interface ViewerProps {
  scenes: SceneInfo[];
  config: SegmentationConfig;
  setupError?: string;
}

interface ModelStatsError {
  modelName: string;
  message: string;
}

export default function Viewer({ scenes, config, setupError }: ViewerProps) {
  const [sceneIndex, setSceneIndex] = useState(0);
  const [mode, setMode] = useState<ViewMode>("single");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [leftIndex, setLeftIndex] = useState(0);
  const [rightIndex, setRightIndex] = useState(1);
  const [opacity, setOpacity] = useState(0.65);
  const [hiddenClasses, setHiddenClasses] = useState<Set<number>>(new Set());

  // Lazy stats
  const [sceneStats, setSceneStats] = useState<Map<string, ModelStats[]>>(new Map());
  const [sceneStatsErrors, setSceneStatsErrors] = useState<Map<string, ModelStatsError[]>>(new Map());
  const [statsRequestErrors, setStatsRequestErrors] = useState<Map<string, string>>(new Map());
  const [statsRetryNonce, setStatsRetryNonce] = useState(0);
  const fetchedRef = useRef<Set<string>>(new Set());

  const [showHelp, setShowHelp] = useState(false);

  // Hover state
  const [hoverClassIndex, setHoverClassIndex] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const [hoverY, setHoverY] = useState(0);
  const [hoverVisible, setHoverVisible] = useState(false);

  // Diff hover state
  const [diffHoverInfo, setDiffHoverInfo] = useState<{ classA: number | null; classB: number | null; classGT: number | null } | null>(null);
  const [diffHoverX, setDiffHoverX] = useState(0);
  const [diffHoverY, setDiffHoverY] = useState(0);
  const [diffHoverVisible, setDiffHoverVisible] = useState(false);

  const scene = scenes[sceneIndex];

  // Fetch stats lazily when scene changes
  useEffect(() => {
    if (!scene) return;
    if (fetchedRef.current.has(scene.id)) return;
    fetchedRef.current.add(scene.id);

    fetch(`/api/stats?sceneId=${encodeURIComponent(scene.id)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Stats request failed (${res.status})`);
        return data as { stats: ModelStats[]; errors?: ModelStatsError[] };
      })
      .then((data) => {
        setSceneStats((prev) => {
          const next = new Map(prev);
          next.set(scene.id, data.stats);
          return next;
        });
        setSceneStatsErrors((prev) => {
          const next = new Map(prev);
          next.set(scene.id, data.errors ?? []);
          return next;
        });
      })
      .catch((error) => {
        fetchedRef.current.delete(scene.id);
        setStatsRequestErrors((prev) => {
          const next = new Map(prev);
          next.set(scene.id, error instanceof Error ? error.message : String(error));
          return next;
        });
      });
  }, [scene, statsRetryNonce]);

  const handleHover = useCallback(
    (classIndex: number | null, x: number, y: number) => {
      if (classIndex === null) {
        setHoverVisible(false);
      } else {
        setHoverClassIndex(classIndex);
        setHoverX(x);
        setHoverY(y);
        setHoverVisible(true);
      }
    },
    []
  );

  const handleDiffHover = useCallback(
    (info: { classA: number | null; classB: number | null; classGT: number | null } | null, x: number, y: number) => {
      if (!info) {
        setDiffHoverVisible(false);
      } else {
        setDiffHoverInfo(info);
        setDiffHoverX(x);
        setDiffHoverY(y);
        setDiffHoverVisible(true);
      }
    },
    []
  );

  const toggleClass = useCallback((classIndex: number) => {
    setHiddenClasses((prev) => {
      const next = new Set(prev);
      if (next.has(classIndex)) next.delete(classIndex);
      else next.add(classIndex);
      return next;
    });
  }, []);

  if (!scene) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-8">
        <div className="glass-panel p-10 rounded-3xl max-w-2xl border-dashed border-2 border-white/10">
          {setupError ? (
            <AlertTriangle className="text-red-400 mx-auto mb-6" size={64} />
          ) : (
            <Activity className="text-blue-400 mx-auto mb-6 opacity-50" size={64} />
          )}
          <h2 className="text-2xl font-bold text-white mb-4">
            {setupError ? "Inference Data Is Invalid" : "No Inference Data Found"}
          </h2>
          {setupError && (
            <p className="text-left text-red-200 bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-6 font-mono text-sm break-words">
              {setupError}
            </p>
          )}
          <p className="text-gray-400 mb-6 leading-relaxed">
            Add a validated config and scene directories under:
            <code className="bg-white/5 px-2 py-1 rounded text-blue-300 select-all block mt-3 font-mono text-sm">
              public/inference_comparison/
            </code>
          </p>
          <div className="text-left bg-black/40 p-5 rounded-xl border border-white/5 text-sm">
            <p className="text-gray-300 font-semibold mb-2">Minimal artifact layout:</p>
            <pre className="text-gray-500 font-mono leading-tight overflow-x-auto">
              public/inference_comparison/<br />
              ├── config.json<br />
              └── scene_id/<br />
                  ├── input.jpg<br />
                  ├── gt.png<br />
                  └── model.png
            </pre>
            <p className="text-gray-500 mt-4">
              See README.md for the mask encoding, config schema, validation rules, and optional provenance metadata.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const artifactSrc = (filename: string) =>
    `/api/artifact?sceneId=${encodeURIComponent(scene.id)}&filename=${encodeURIComponent(filename)}`;
  const inputSrc = artifactSrc(scene.inputImage);
  const allModels: (ModelOption & { provenance?: ArtifactProvenance })[] = [
    { name: "Ground Truth", filename: scene.groundTruth, isGroundTruth: true },
    ...scene.models.map((model) => ({
      name: model.name,
      filename: model.filename,
      provenance: model.provenance,
    })),
  ];
  const clampModelIndex = (index: number) =>
    Math.min(Math.max(index, 0), allModels.length - 1);
  const safeSelectedIndex = clampModelIndex(selectedIndex);
  const safeLeftIndex = clampModelIndex(leftIndex);
  const safeRightIndex = clampModelIndex(rightIndex);
  const getMaskSrc = (index: number) =>
    artifactSrc(allModels[clampModelIndex(index)].filename);
  const currentSceneStats = sceneStats.get(scene.id);
  const currentModel = allModels[safeSelectedIndex];
  const currentStats = !currentModel.isGroundTruth
    ? currentSceneStats?.find((stats) => stats.modelName === currentModel.name)
    : undefined;
  const statsLoading =
    !currentSceneStats && !statsRequestErrors.has(scene.id);
  const statsErrors = sceneStatsErrors.get(scene.id) ?? [];
  const statsRequestError = statsRequestErrors.get(scene.id);
  const provenanceEntries = Object.entries({
    ...scene.provenance,
    ...currentModel.provenance,
  }).filter((entry): entry is [string, string] => typeof entry[1] === "string");

  const goToScene = (idx: number) => {
    if (idx >= 0 && idx < scenes.length) {
      setSceneIndex(idx);
    }
  };

  const retryStats = () => {
    fetchedRef.current.delete(scene.id);
    setStatsRequestErrors((prev) => {
      const next = new Map(prev);
      next.delete(scene.id);
      return next;
    });
    setStatsRetryNonce((value) => value + 1);
  };

  return (
    <div className="max-w-[1600px] mx-auto space-y-5 p-4 md:p-6 lg:p-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 glass-panel p-5 rounded-2xl">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-blue-400 via-cyan-400 to-purple-500 bg-clip-text text-transparent mb-1">
            {config.title || config.dataset || "Semantic Segmentation Analysis"}
          </h1>
          <p className="text-sm text-gray-400">
            {scene.title ? `${scene.title} · ` : ""}{scenes.length} scene{scenes.length !== 1 ? "s" : ""} · {scene.models.length} model{scene.models.length !== 1 ? "s" : ""} · {config.labels.length} classes
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowHelp(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-all font-medium"
          >
            <HelpCircle size={18} />
            <span className="hidden sm:inline">Setup Guide</span>
          </button>

          {/* Opacity Control */}
          <div className="flex items-center gap-3 bg-black/40 px-4 py-2 rounded-xl border border-white/10">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Overlay</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              className="w-28 accent-blue-500 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-sm font-bold text-white tabular-nums w-10 text-right">
              {Math.round(opacity * 100)}%
            </span>
          </div>
        </div>
      </header>

      {/* Scene Navigator */}
      <div className="glass-panel px-5 py-3 rounded-2xl flex items-center gap-4">
        <span className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Scene</span>
        <button
          onClick={() => goToScene(sceneIndex - 1)}
          disabled={sceneIndex === 0}
          className="p-1.5 rounded-lg bg-black/40 border border-white/10 text-gray-300 hover:text-white hover:bg-white/10 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronLeft size={16} />
        </button>
        <select
          value={sceneIndex}
          onChange={(e) => goToScene(Number(e.target.value))}
          className="bg-black/50 text-white text-sm px-3 py-1.5 rounded-lg border border-white/10 focus:outline-none focus:border-blue-500 transition-colors min-w-[120px]"
        >
          {scenes.map((s, i) => (
            <option key={s.id} value={i}>
              {s.id}
            </option>
          ))}
        </select>
        <button
          onClick={() => goToScene(sceneIndex + 1)}
          disabled={sceneIndex === scenes.length - 1}
          className="p-1.5 rounded-lg bg-black/40 border border-white/10 text-gray-300 hover:text-white hover:bg-white/10 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronRight size={16} />
        </button>
        <span className="text-xs text-gray-500 tabular-nums">
          {sceneIndex + 1} / {scenes.length}
        </span>
      </div>

      {/* Model Selector */}
      <ModelSelector
        models={allModels}
        mode={mode}
        onModeChange={setMode}
        selectedIndex={safeSelectedIndex}
        onSelectModel={setSelectedIndex}
        leftIndex={safeLeftIndex}
        rightIndex={safeRightIndex}
        onSelectLeft={setLeftIndex}
        onSelectRight={setRightIndex}
      />

      {(statsRequestError || statsErrors.length > 0) && (
        <div className="glass-panel border-red-500/30 bg-red-500/5 rounded-2xl p-4 text-sm">
          <p className="font-semibold text-red-300 flex items-center gap-2 mb-2">
            <AlertTriangle size={17} /> Artifact validation errors
          </p>
          {statsRequestError && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-red-200">{statsRequestError}</p>
              <button
                onClick={retryStats}
                className="rounded-lg border border-red-400/30 px-3 py-1 text-red-100 hover:bg-red-500/10"
              >
                Retry metrics
              </button>
            </div>
          )}
          {statsErrors.map((error) => (
            <p key={error.modelName} className="text-red-200 break-words">
              <span className="font-semibold">{error.modelName}:</span> {error.message}
            </p>
          ))}
        </div>
      )}

      {provenanceEntries.length > 0 && (
        <details className="glass-panel rounded-2xl px-5 py-4 text-sm">
          <summary className="cursor-pointer font-semibold text-gray-200">
            Artifact provenance for {currentModel.name}
          </summary>
          <dl className="grid grid-cols-1 md:grid-cols-[8rem_1fr] gap-x-4 gap-y-2 mt-4">
            {provenanceEntries.map(([key, value]) => (
              <div key={key} className="contents">
                <dt className="text-gray-500 capitalize">{key}</dt>
                <dd className="text-gray-300 font-mono break-all">{value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Canvas Area */}
        <div className="lg:col-span-8 space-y-4">
          {mode === "single" && (
            <div className="glass-panel p-2 rounded-2xl overflow-hidden shadow-2xl border border-white/5">
              <MaskCanvas
                inputImageSrc={inputSrc}
                maskSrc={getMaskSrc(safeSelectedIndex)}
                labels={config.labels}
                hiddenClasses={hiddenClasses}
                opacity={opacity}
                onHover={handleHover}
              />
            </div>
          )}

          {mode === "sideBySide" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-center text-sm font-semibold text-gray-300">
                  {allModels[safeLeftIndex].name}
                </div>
                <div className="glass-panel p-2 rounded-2xl overflow-hidden shadow-2xl border border-white/5">
                  <MaskCanvas
                    inputImageSrc={inputSrc}
                    maskSrc={getMaskSrc(safeLeftIndex)}
                    labels={config.labels}
                    hiddenClasses={hiddenClasses}
                    opacity={opacity}
                    onHover={handleHover}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-center text-sm font-semibold text-gray-300">
                  {allModels[safeRightIndex].name}
                </div>
                <div className="glass-panel p-2 rounded-2xl overflow-hidden shadow-2xl border border-white/5">
                  <MaskCanvas
                    inputImageSrc={inputSrc}
                    maskSrc={getMaskSrc(safeRightIndex)}
                    labels={config.labels}
                    hiddenClasses={hiddenClasses}
                    opacity={opacity}
                    onHover={handleHover}
                  />
                </div>
              </div>
            </div>
          )}

          {mode === "diff" && (
            <div className="space-y-3">
              <div className="flex items-center justify-center gap-6 text-sm font-medium">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-green-500 inline-block" />
                  Agree + Correct
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-orange-400 inline-block" />
                  Agree + Wrong
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-red-500 inline-block" />
                  Disagree
                </span>
              </div>
              <div className="glass-panel p-2 rounded-2xl overflow-hidden shadow-2xl border border-white/5">
                <DiffCanvas
                  inputImageSrc={inputSrc}
                  maskSrcA={getMaskSrc(safeLeftIndex)}
                  maskSrcB={getMaskSrc(safeRightIndex)}
                  gtMaskSrc={artifactSrc(scene.groundTruth)}
                  numClasses={config.labels.length}
                  hiddenClasses={hiddenClasses}
                  opacity={opacity}
                  onHover={handleDiffHover}
                />
              </div>
            </div>
          )}

          {/* Stats Cards */}
          {mode === "single" && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="glass-panel p-5 rounded-2xl flex items-center gap-4">
                <div className="bg-blue-500/20 p-3 rounded-xl">
                  <Activity className="text-blue-400" size={24} />
                </div>
                <div>
                  <p className="text-sm text-gray-400 mb-0.5">Scene mIoU (GT-present)</p>
                  <p className="text-2xl font-bold text-white tabular-nums">
                    {statsLoading ? (
                      <Loader2 className="animate-spin text-gray-500 inline" size={20} />
                    ) : currentStats ? (
                      `${currentStats.mIoU.toFixed(2)}%`
                    ) : (
                      <span className="text-gray-500 text-base">—</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="glass-panel p-5 rounded-2xl flex items-center gap-4">
                <div className="bg-green-500/20 p-3 rounded-xl">
                  <LayoutTemplate className="text-green-400" size={24} />
                </div>
                <div>
                  <p className="text-sm text-gray-400 mb-0.5">Pixel Accuracy</p>
                  <p className="text-2xl font-bold text-white tabular-nums">
                    {statsLoading ? (
                      <Loader2 className="animate-spin text-gray-500 inline" size={20} />
                    ) : currentStats ? (
                      `${currentStats.pixelAccuracy.toFixed(2)}%`
                    ) : (
                      <span className="text-gray-500 text-base">—</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="glass-panel p-5 rounded-2xl flex items-center gap-4">
                <div className="bg-purple-500/20 p-3 rounded-xl">
                  <Activity className="text-purple-400" size={24} />
                </div>
                <div>
                  <p className="text-sm text-gray-400 mb-0.5">Union mIoU</p>
                  <p className="text-2xl font-bold text-white tabular-nums">
                    {statsLoading ? (
                      <Loader2 className="animate-spin text-gray-500 inline" size={20} />
                    ) : currentStats ? (
                      `${currentStats.unionMIoU.toFixed(2)}%`
                    ) : (
                      <span className="text-gray-500 text-base">—</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}
          {mode === "single" && currentStats && currentStats.predictionOnlyClasses.length > 0 && (
            <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-100">
              Predicted classes absent from this frame&apos;s ground truth: {currentStats.predictionOnlyClasses.map((classStats) => `${classStats.readable} (${classStats.predPixels.toLocaleString()} px)`).join(", ")}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="lg:col-span-4 lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)]">
          <ClassLegend
            labels={config.labels}
            hiddenClasses={hiddenClasses}
            onToggleClass={toggleClass}
            classIoUs={currentStats?.classIoUs}
          />
        </div>
      </div>

      {/* Tooltips */}
      <HoverTooltip
        classIndex={hoverClassIndex}
        labels={config.labels}
        x={hoverX}
        y={hoverY}
        visible={hoverVisible}
      />
      <DiffTooltip
        info={diffHoverInfo}
        labels={config.labels}
        leftName={allModels[safeLeftIndex].name}
        rightName={allModels[safeRightIndex].name}
        x={diffHoverX}
        y={diffHoverY}
        visible={diffHoverVisible}
      />

      {/* Help Modal */}
      {showHelp && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
          <div 
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            onClick={() => setShowHelp(false)}
          />
          <div className="relative glass-panel p-8 rounded-3xl max-w-2xl w-full shadow-2xl border border-white/10 overflow-hidden">
            <button 
              onClick={() => setShowHelp(false)}
              className="absolute top-6 right-6 p-2 rounded-full hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
            >
              <X size={24} />
            </button>

            <div className="flex items-center gap-4 mb-6">
              <div className="bg-blue-500/20 p-3 rounded-2xl">
                <HelpCircle className="text-blue-400" size={32} />
              </div>
              <h2 className="text-2xl font-bold text-white">How to Add Data</h2>
            </div>

            <div className="space-y-6">
              <p className="text-gray-400 leading-relaxed">
                Add your scene directories and configuration to the following folder:
                <br />
                <code className="bg-white/5 px-3 py-1.5 rounded text-blue-300 select-all block mt-3 font-mono text-sm border border-white/5">
                  public/inference_comparison/
                </code>
              </p>

              <div className="bg-black/40 p-5 rounded-2xl border border-white/5">
                <p className="text-gray-300 font-semibold mb-3">Expected directory structure:</p>
                <pre className="text-gray-400 font-mono text-sm leading-relaxed overflow-x-auto">
                  public/inference_comparison/<br />
                  ├── config.json<br />
                  └── scene_id/ <span className="text-gray-600 ml-4"># Scene directory</span><br />
                      ├── input.jpg <span className="text-gray-600 ml-4"># Original RGB image</span><br />
                      ├── gt.png    <span className="text-gray-600 ml-4"># Ground truth mask</span><br />
                      ├── model1.png<span className="text-gray-600 ml-4"># Auto-discovered</span><br />
                      └── model2.png<span className="text-gray-600 ml-4"># Auto-discovered</span>
                </pre>
              </div>

              <div className="pt-6 border-t border-white/10 text-sm text-gray-400">
                Masks must be exact 8-bit grayscale class-index PNGs; RGB, palette, and 16-bit masks are rejected. Ground truth may also use the configured ignore index. See README.md for the complete schema and optional <code className="text-blue-300">scene.json</code> provenance.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
