"use client";

interface HoverTooltipProps {
  classIndex: number | null;
  labels: { color: [number, number, number]; name: string; readable: string }[];
  x: number;
  y: number;
  visible: boolean;
}

export default function HoverTooltip({ classIndex, labels, x, y, visible }: HoverTooltipProps) {
  if (!visible || classIndex === null || classIndex === 255 || classIndex >= labels.length) {
    return null;
  }

  const label = labels[classIndex];
  const rgbStr = `rgb(${label.color.join(",")})`;

  return (
    <div
      className="fixed z-[9999] pointer-events-none"
      style={{
        left: x + 16,
        top: y - 12,
      }}
    >
      <div className="bg-gray-900/95 backdrop-blur-md border border-white/15 rounded-lg px-3 py-2 shadow-2xl flex items-center gap-2.5 min-w-[120px]">
        <div
          className="w-4 h-4 rounded-sm shadow-sm flex-shrink-0"
          style={{ backgroundColor: rgbStr }}
        />
        <div className="flex flex-col">
          <span className="text-white text-sm font-semibold leading-tight">
            {label.readable.split("(")[0].trim()}
          </span>
          <span className="text-gray-400 text-[10px] font-mono">
            idx: {classIndex} · rgb({label.color.join(", ")})
          </span>
        </div>
      </div>
    </div>
  );
}
