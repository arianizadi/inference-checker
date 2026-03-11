"use client";

import { Columns2, GitCompareArrows, Layers } from "lucide-react";

export type ViewMode = "single" | "sideBySide" | "diff";

export interface ModelOption {
  name: string;
  filename: string;
  isGroundTruth?: boolean;
}

interface ModelSelectorProps {
  models: ModelOption[];
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
  // Single mode
  selectedIndex: number;
  onSelectModel: (index: number) => void;
  // Side-by-side / Diff
  leftIndex: number;
  rightIndex: number;
  onSelectLeft: (index: number) => void;
  onSelectRight: (index: number) => void;
}

export default function ModelSelector({
  models,
  mode,
  onModeChange,
  selectedIndex,
  onSelectModel,
  leftIndex,
  rightIndex,
  onSelectLeft,
  onSelectRight,
}: ModelSelectorProps) {
  return (
    <div className="glass-panel px-5 py-4 rounded-2xl space-y-4">
      {/* Mode Switcher */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400 uppercase tracking-wider font-semibold mr-2">Mode</span>
        <div className="flex bg-black/50 p-1 rounded-xl border border-white/10">
          <button
            onClick={() => onModeChange("single")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              mode === "single"
                ? "bg-blue-600 text-white shadow-lg shadow-blue-500/30"
                : "text-gray-400 hover:text-white hover:bg-white/5"
            }`}
          >
            <Layers size={14} />
            Single
          </button>
          <button
            onClick={() => onModeChange("sideBySide")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              mode === "sideBySide"
                ? "bg-blue-600 text-white shadow-lg shadow-blue-500/30"
                : "text-gray-400 hover:text-white hover:bg-white/5"
            }`}
          >
            <Columns2 size={14} />
            Compare
          </button>
          <button
            onClick={() => onModeChange("diff")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              mode === "diff"
                ? "bg-blue-600 text-white shadow-lg shadow-blue-500/30"
                : "text-gray-400 hover:text-white hover:bg-white/5"
            }`}
          >
            <GitCompareArrows size={14} />
            Diff
          </button>
        </div>
      </div>

      {/* Model tabs / dropdowns based on mode */}
      {mode === "single" && (
        <div className="flex flex-wrap gap-1.5">
          {models.map((model, idx) => (
            <button
              key={model.filename}
              onClick={() => onSelectModel(idx)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                selectedIndex === idx
                  ? model.isGroundTruth
                    ? "bg-green-600 text-white shadow-lg shadow-green-500/30"
                    : "bg-blue-600 text-white shadow-lg shadow-blue-500/30"
                  : "text-gray-400 hover:text-white hover:bg-white/5 bg-black/30"
              }`}
            >
              {model.name}
            </button>
          ))}
        </div>
      )}

      {(mode === "sideBySide" || mode === "diff") && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 font-semibold uppercase">Left</span>
            <select
              value={leftIndex}
              onChange={(e) => onSelectLeft(Number(e.target.value))}
              className="bg-black/50 text-white text-sm px-3 py-1.5 rounded-lg border border-white/10 focus:outline-none focus:border-blue-500 transition-colors"
            >
              {models.map((m, i) => (
                <option key={m.filename} value={i}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <span className="text-gray-500 text-xs font-bold">vs</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 font-semibold uppercase">Right</span>
            <select
              value={rightIndex}
              onChange={(e) => onSelectRight(Number(e.target.value))}
              className="bg-black/50 text-white text-sm px-3 py-1.5 rounded-lg border border-white/10 focus:outline-none focus:border-blue-500 transition-colors"
            >
              {models.map((m, i) => (
                <option key={m.filename} value={i}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
