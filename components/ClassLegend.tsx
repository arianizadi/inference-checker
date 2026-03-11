"use client";

import { motion, AnimatePresence } from "framer-motion";

interface ClassLegendProps {
  labels: { color: [number, number, number]; name: string; readable: string }[];
  hiddenClasses: Set<number>;
  onToggleClass: (classIndex: number) => void;
  classIoUs?: { classIndex: number; iou: number; intersection?: number; gtPixels?: number }[];
}

export default function ClassLegend({
  labels,
  hiddenClasses,
  onToggleClass,
  classIoUs,
}: ClassLegendProps) {
  // Build Stats lookup map
  const statsMap = new Map<number, { iou: number; acc: number }>();
  if (classIoUs) {
    for (const c of classIoUs) {
      const acc = c.gtPixels && c.intersection !== undefined ? (c.intersection / c.gtPixels) * 100 : 0;
      statsMap.set(c.classIndex, { iou: c.iou, acc });
    }
  }

  return (
    <div className="glass-panel p-5 rounded-2xl h-full flex flex-col">
      <h3 className="font-semibold text-lg mb-4 flex items-center justify-between">
        Class Legend
        <span className="text-xs bg-white/10 px-2 py-1 rounded-md text-gray-300">
          Click to filter
        </span>
      </h3>

      <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-2">
        <AnimatePresence>
          {labels.map((label, idx) => {
            const isHidden = hiddenClasses.has(idx);
            const rgbStr = `rgb(${label.color.join(",")})`;
            const stats = statsMap.get(idx);

            return (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.025 }}
                key={label.name}
                onClick={() => onToggleClass(idx)}
                className={`flex flex-col p-3 rounded-xl border border-white/5 cursor-pointer transition-all ${
                  isHidden
                    ? "opacity-40 grayscale bg-transparent"
                    : "bg-white/5 hover:bg-white/10 hover:scale-[1.02]"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3.5 h-3.5 rounded-sm shadow-sm flex-shrink-0"
                      style={{ backgroundColor: rgbStr }}
                    />
                    <span className="font-medium text-sm capitalize truncate max-w-[140px]">
                      {label.readable.split("(")[0].trim()}
                    </span>
                  </div>
                  {stats !== undefined && (
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col items-end">
                        <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold leading-none mb-0.5">IoU</span>
                        <span className="text-[13px] font-bold opacity-90 tabular-nums leading-none">
                          {stats.iou.toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold leading-none mb-0.5">Acc</span>
                        <span className="text-[13px] font-bold opacity-90 tabular-nums leading-none">
                          {stats.acc.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {stats !== undefined && (
                  <div className="w-full space-y-1.5 mt-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-black/40 h-1.5 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ backgroundColor: rgbStr }}
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(stats.iou, 100)}%` }}
                          transition={{ duration: 0.8, ease: "easeOut" }}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-black/40 h-1.5 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full rounded-full opacity-60"
                          style={{ backgroundColor: rgbStr }}
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(stats.acc, 100)}%` }}
                          transition={{ duration: 0.8, ease: "easeOut" }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
