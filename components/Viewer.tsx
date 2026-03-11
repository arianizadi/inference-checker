"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Activity, LayoutTemplate, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import MaskCanvas from "./MaskCanvas";
import DiffCanvas from "./DiffCanvas";
import ClassLegend from "./ClassLegend";
import HoverTooltip from "./HoverTooltip";
import DiffTooltip from "./DiffTooltip";
import ModelSelector, { ViewMode, ModelOption } from "./ModelSelector";
import type { RS19Config } from "../lib/data";
import type { ModelStats } from "../lib/stats";

interface ViewerModel {
  name: string;
  filename: string;
}

interface SceneInfo {
  id: string;
  inputImage: string;
  groundTruth: string;
  models: ViewerModel[];
}

interface ViewerProps {
  scenes: SceneInfo[];
  config: RS19Config;
}

export default function Viewer({ scenes, config }: ViewerProps) {
  const [sceneIndex, setSceneIndex] = useState(0);
  const [mode, setMode] = useState<ViewMode>("single");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [leftIndex, setLeftIndex] = useState(0);
  const [rightIndex, setRightIndex] = useState(1);
  const [opacity, setOpacity] = useState(0.65);
  const [hiddenClasses, setHiddenClasses] = useState<Set<number>>(new Set());

  // Lazy stats
  const [sceneStats, setSceneStats] = useState<Map<string, ModelStats[]>>(new Map());
  const [statsLoading, setStatsLoading] = useState(false);
  const fetchedRef = useRef<Set<string>>(new Set());

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

    setStatsLoading(true);
    fetch(`/api/stats?sceneId=${encodeURIComponent(scene.id)}`)
      .then((res) => res.json())
      .then((data) => {
        setSceneStats((prev) => {
          const next = new Map(prev);
          next.set(scene.id, data.stats);
          return next;
        });
      })
      .catch((err) => console.error("Failed to fetch stats:", err))
      .finally(() => setStatsLoading(false));
  }, [scene]);

  if (!scene) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-8">
        <div className="glass-panel p-10 rounded-3xl max-w-2xl border-dashed border-2 border-white/10">
          <Activity className="text-blue-400 mx-auto mb-6 opacity-50" size={64} />
          <h2 className="text-2xl font-bold text-white mb-4">No Inference Data Found</h2>
          <p className="text-gray-400 mb-6 leading-relaxed">
            To get started, please add scene directories to the following location:
            <br />
            <code className="bg-white/5 px-2 py-1 rounded text-blue-300 select-all block mt-3 font-mono text-sm">
              public/inference_comparison/
            </code>
          </p>
          <div className="text-left bg-black/40 p-5 rounded-xl border border-white/5 space-y-4 text-sm">
            <div>
              <p className="text-gray-300 font-semibold mb-2">Expected directory structure:</p>
              <pre className="text-gray-500 font-mono leading-tight">
                public/inference_comparison/<br />
                ├── rs19-config.json<br />
                └── scene_id_01/  <span className="text-gray-600">← rename as you like</span><br />
                    ├── input.jpg <span className="text-gray-600">← original image</span><br />
                    ├── gt.png    <span className="text-gray-600">← ground truth mask</span><br />
                    └── model.png <span className="text-gray-600">← auto-discovered predictions</span>
              </pre>
            </div>
            
            <div className="pt-3 border-t border-white/10">
              <p className="text-gray-400 mb-2">You can generate this folder structure using this script:</p>
              <a 
                href="https://github.com/arianizadi/mmseg-arian/blob/main/tools/run_all_models_inference.py"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 underline font-mono break-all"
              >
                run_all_models_inference.py
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }
  const basePath = `/inference_comparison/${scene.id}`;
  const inputSrc = `${basePath}/${scene.inputImage}`;

  // Build unified model list: Ground Truth + all models
  const allModels: ModelOption[] = [
    { name: "Ground Truth", filename: scene.groundTruth, isGroundTruth: true },
    ...scene.models.map((m) => ({ name: m.name, filename: m.filename })),
  ];

  const getMaskSrc = (index: number) =>
    `${basePath}/${allModels[index].filename}`;

  // Look up current scene stats
  const currentSceneStats = sceneStats.get(scene.id);
  const currentModelName = allModels[selectedIndex]?.name;
  const currentStats = currentModelName && !allModels[selectedIndex]?.isGroundTruth
    ? currentSceneStats?.find((s) => s.modelName === currentModelName)
    : undefined;

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

  const goToScene = (idx: number) => {
    if (idx >= 0 && idx < scenes.length) {
      setSceneIndex(idx);
    }
  };

  return (
    <div className="max-w-[1600px] mx-auto space-y-5 p-4 md:p-6 lg:p-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 glass-panel p-5 rounded-2xl">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-blue-400 via-cyan-400 to-purple-500 bg-clip-text text-transparent mb-1">
            RailSem19 Inference Viewer
          </h1>
          <p className="text-sm text-gray-400">
            {scenes.length} scene{scenes.length !== 1 ? "s" : ""} · {scene.models.length} model{scene.models.length !== 1 ? "s" : ""} · {config.labels.length} classes
          </p>
        </div>

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
        selectedIndex={selectedIndex}
        onSelectModel={setSelectedIndex}
        leftIndex={leftIndex}
        rightIndex={rightIndex}
        onSelectLeft={setLeftIndex}
        onSelectRight={setRightIndex}
      />

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Canvas Area */}
        <div className="lg:col-span-8 space-y-4">
          {mode === "single" && (
            <div className="glass-panel p-2 rounded-2xl overflow-hidden shadow-2xl border border-white/5">
              <MaskCanvas
                inputImageSrc={inputSrc}
                maskSrc={getMaskSrc(selectedIndex)}
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
                  {allModels[leftIndex].name}
                </div>
                <div className="glass-panel p-2 rounded-2xl overflow-hidden shadow-2xl border border-white/5">
                  <MaskCanvas
                    inputImageSrc={inputSrc}
                    maskSrc={getMaskSrc(leftIndex)}
                    labels={config.labels}
                    hiddenClasses={hiddenClasses}
                    opacity={opacity}
                    onHover={handleHover}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-center text-sm font-semibold text-gray-300">
                  {allModels[rightIndex].name}
                </div>
                <div className="glass-panel p-2 rounded-2xl overflow-hidden shadow-2xl border border-white/5">
                  <MaskCanvas
                    inputImageSrc={inputSrc}
                    maskSrc={getMaskSrc(rightIndex)}
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
                  maskSrcA={getMaskSrc(leftIndex)}
                  maskSrcB={getMaskSrc(rightIndex)}
                  gtMaskSrc={`${basePath}/${scene.groundTruth}`}
                  numClasses={config.labels.length}
                  opacity={opacity}
                  onHover={handleDiffHover}
                />
              </div>
            </div>
          )}

          {/* Stats Cards */}
          {mode === "single" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="glass-panel p-5 rounded-2xl flex items-center gap-4">
                <div className="bg-blue-500/20 p-3 rounded-xl">
                  <Activity className="text-blue-400" size={24} />
                </div>
                <div>
                  <p className="text-sm text-gray-400 mb-0.5">Mean IoU (mIoU)</p>
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
        leftName={allModels[leftIndex]?.name ?? "Left"}
        rightName={allModels[rightIndex]?.name ?? "Right"}
        x={diffHoverX}
        y={diffHoverY}
        visible={diffHoverVisible}
      />
    </div>
  );
}
