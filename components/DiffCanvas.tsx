"use client";

import { useEffect, useRef, useCallback } from "react";

interface DiffCanvasProps {
  inputImageSrc: string;
  maskSrcA: string;
  maskSrcB: string;
  gtMaskSrc: string;
  numClasses: number;
  hiddenClasses: Set<number>;
  opacity: number;
  onHover?: (info: { classA: number | null; classB: number | null; classGT: number | null } | null, x: number, y: number) => void;
  className?: string;
}

// Colors for diff visualization
const AGREE_CORRECT = [0, 200, 80];   // Green: both models agree AND match GT
const AGREE_WRONG = [255, 165, 0];    // Orange: both agree but wrong
const DISAGREE = [220, 40, 40];       // Red: models disagree

export default function DiffCanvas({
  inputImageSrc,
  maskSrcA,
  maskSrcB,
  gtMaskSrc,
  numClasses,
  hiddenClasses,
  opacity,
  onHover,
  className = "",
}: DiffCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskARef = useRef<Uint8Array | null>(null);
  const maskBRef = useRef<Uint8Array | null>(null);
  const maskGTRef = useRef<Uint8Array | null>(null);
  const dimensionsRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });

  // Load base image
  useEffect(() => {
    const canvas = baseCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      dimensionsRef.current = { width: img.width, height: img.height };
      ctx.drawImage(img, 0, 0);
    };
    img.src = inputImageSrc;
  }, [inputImageSrc]);

  const readMaskIndices = useCallback((src: string): Promise<Uint8Array> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const offscreen = document.createElement("canvas");
        offscreen.width = img.width;
        offscreen.height = img.height;
        const ctx = offscreen.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);
        const raw = ctx.getImageData(0, 0, img.width, img.height);
        const indices = new Uint8Array(img.width * img.height);
        for (let i = 0; i < indices.length; i++) {
          indices[i] = raw.data[i * 4];
        }
        resolve(indices);
      };
      img.src = src;
    });
  }, []);

  const renderDiff = useCallback((
    ctx: CanvasRenderingContext2D,
    maskA: Uint8Array,
    maskB: Uint8Array,
    maskGT: Uint8Array,
    width: number,
    height: number
  ) => {
    const canvas = ctx.canvas;
    canvas.width = width;
    canvas.height = height;

    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    for (let i = 0; i < maskA.length; i++) {
        const a = maskA[i];
        const b = maskB[i];
        const gt = maskGT[i];
        const px = i * 4;

        // Skip ignore pixels and globally hidden pixels
        if (gt === 255 || gt >= numClasses || (hiddenClasses.has(gt) && hiddenClasses.has(a) && hiddenClasses.has(b))) {
            data[px + 3] = 0;
            continue;
        }

        let color: number[];
        if (a === b) {
            // Models agree
            color = a === gt ? AGREE_CORRECT : AGREE_WRONG;
        } else {
            // Models disagree
            color = DISAGREE;
        }

        data[px] = color[0];
        data[px + 1] = color[1];
        data[px + 2] = color[2];
        data[px + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);
  }, [numClasses, hiddenClasses]);

  // Re-render when hidden classes change (without reloading mask)
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas || !maskARef.current || !maskBRef.current || !maskGTRef.current) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    
    renderDiff(
      ctx,
      maskARef.current,
      maskBRef.current,
      maskGTRef.current,
      canvas.width,
      canvas.height
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenClasses, renderDiff]);

  // Load all three masks and compute diff
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    Promise.all([
      readMaskIndices(maskSrcA),
      readMaskIndices(maskSrcB),
      readMaskIndices(gtMaskSrc),
    ]).then(([maskA, maskB, maskGT]) => {
      maskARef.current = maskA;
      maskBRef.current = maskB;
      maskGTRef.current = maskGT;

      // Infer dimensions from base canvas
      const { width, height } = dimensionsRef.current;
      if (width === 0 || height === 0) {
        // Wait for base image to load
        setTimeout(() => {
          const { width: w, height: h } = dimensionsRef.current;
          if (w > 0 && h > 0) renderDiff(ctx, maskA, maskB, maskGT, w, h);
        }, 500);
        return;
      }
      renderDiff(ctx, maskA, maskB, maskGT, width, height);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maskSrcA, maskSrcB, gtMaskSrc, readMaskIndices, renderDiff]);


  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onHover || !maskARef.current || !maskBRef.current || !maskGTRef.current || !containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const { width, height } = dimensionsRef.current;
      if (width === 0 || height === 0) return;

      const containerW = rect.width;
      const containerH = rect.height;
      const scale = Math.min(containerW / width, containerH / height);
      const displayW = width * scale;
      const displayH = height * scale;
      const offsetX = (containerW - displayW) / 2;
      const offsetY = (containerH - displayH) / 2;

      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      if (mouseX < offsetX || mouseX > offsetX + displayW || mouseY < offsetY || mouseY > offsetY + displayH) {
        onHover(null, e.clientX, e.clientY);
        return;
      }

      const imgX = Math.floor(((mouseX - offsetX) / displayW) * width);
      const imgY = Math.floor(((mouseY - offsetY) / displayH) * height);
      const pixelIdx = imgY * width + imgX;

      if (pixelIdx >= 0 && pixelIdx < maskARef.current.length) {
        const classA = maskARef.current[pixelIdx];
        const classB = maskBRef.current[pixelIdx];
        const classGT = maskGTRef.current[pixelIdx];
        onHover(
          {
            classA: classA === 255 ? null : classA,
            classB: classB === 255 ? null : classB,
            classGT: classGT === 255 ? null : classGT,
          },
          e.clientX,
          e.clientY
        );
      } else {
        onHover(null, e.clientX, e.clientY);
      }
    },
    [onHover]
  );

  const handleMouseLeave = useCallback(() => {
    onHover?.(null, 0, 0);
  }, [onHover]);

  return (
    <div
      ref={containerRef}
      className={`relative w-full aspect-[2/1] bg-black rounded-xl overflow-hidden ${className}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <canvas ref={baseCanvasRef} className="absolute inset-0 w-full h-full object-contain" />
      <canvas
        ref={overlayCanvasRef}
        className="absolute inset-0 w-full h-full object-contain transition-opacity duration-150"
        style={{ opacity }}
      />
    </div>
  );
}
