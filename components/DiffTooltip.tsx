"use client";

interface DiffTooltipProps {
  info: { classA: number | null; classB: number | null; classGT: number | null } | null;
  labels: { color: [number, number, number]; name: string; readable: string }[];
  leftName: string;
  rightName: string;
  x: number;
  y: number;
  visible: boolean;
}

export default function DiffTooltip({ info, labels, leftName, rightName, x, y, visible }: DiffTooltipProps) {
  if (!visible || !info) return null;

  const getLabel = (idx: number | null) => {
    if (idx === null || idx >= labels.length) return null;
    return labels[idx];
  };

  const labelA = getLabel(info.classA);
  const labelB = getLabel(info.classB);
  const labelGT = getLabel(info.classGT);

  const agree = info.classA === info.classB;
  const correct = agree && info.classA === info.classGT;

  let statusColor = "bg-red-500";
  let statusText = "Disagree";
  if (agree && correct) {
    statusColor = "bg-green-500";
    statusText = "Agree + Correct";
  } else if (agree) {
    statusColor = "bg-orange-400";
    statusText = "Agree + Wrong";
  }

  // Truncate long model names for the tooltip
  const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max) + "…" : s);

  const renderClassRow = (rowLabel: string, classLabel: ReturnType<typeof getLabel>) => (
    <div className="flex items-center gap-2.5 text-xs leading-snug py-0.5">
      <span className="text-gray-400 min-w-[80px] flex-shrink-0 text-right font-medium">{rowLabel}</span>
      {classLabel ? (
        <>
          <div
            className="w-3 h-3 rounded-sm flex-shrink-0"
            style={{ backgroundColor: `rgb(${classLabel.color.join(",")})` }}
          />
          <span className="text-white whitespace-nowrap">{classLabel.readable.split("(")[0].trim()}</span>
        </>
      ) : (
        <span className="text-gray-500 italic">ignore</span>
      )}
    </div>
  );

  return (
    <div
      className="fixed z-[9999] pointer-events-none"
      style={{ left: x + 16, top: y - 12 }}
    >
      <div className="bg-gray-900/95 backdrop-blur-md border border-white/15 rounded-lg px-4 py-3 shadow-2xl space-y-1 min-w-[240px]">
        <div className="flex items-center gap-1.5 pb-1.5 mb-1 border-b border-white/10">
          <span className={`w-2.5 h-2.5 rounded-full ${statusColor} inline-block`} />
          <span className="text-white text-xs font-bold">{statusText}</span>
        </div>
        {renderClassRow(truncate(leftName, 14), labelA)}
        {renderClassRow(truncate(rightName, 14), labelB)}
        {leftName !== "Ground Truth" && rightName !== "Ground Truth" && renderClassRow("Ground Truth", labelGT)}
      </div>
    </div>
  );
}
