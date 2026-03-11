"use client";

import { useEffect, useRef, useCallback } from "react";

interface MaskCanvasProps {
  inputImageSrc: string;
  maskSrc: string;
  labels: { color: [number, number, number]; name: string }[];
  hiddenClasses: Set<number>;
  opacity: number;
  onHover?: (classIndex: number | null, x: number, y: number) => void;
  className?: string;
}

export default function MaskCanvas({
  inputImageSrc,
  maskSrc,
  labels,
  hiddenClasses,
  opacity,
  onHover,
  className = "",
}: MaskCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskDataRef = useRef<Uint8Array | null>(null);
  const dimensionsRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });

  // Load and draw the base input image
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

  // Load mask and decode + colorize
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const maskImg = new Image();
    maskImg.crossOrigin = "anonymous";
    maskImg.onload = () => {
      canvas.width = maskImg.width;
      canvas.height = maskImg.height;
      dimensionsRef.current = { width: maskImg.width, height: maskImg.height };

      // Draw mask to read raw pixel data
      const offscreen = document.createElement("canvas");
      offscreen.width = maskImg.width;
      offscreen.height = maskImg.height;
      const offCtx = offscreen.getContext("2d", { willReadFrequently: true })!;
      offCtx.drawImage(maskImg, 0, 0);
      const rawData = offCtx.getImageData(0, 0, maskImg.width, maskImg.height);

      // Store class indices for hover lookup
      const indices = new Uint8Array(maskImg.width * maskImg.height);
      for (let i = 0; i < indices.length; i++) {
        indices[i] = rawData.data[i * 4]; // R channel = class index
      }
      maskDataRef.current = indices;

      // Colorize
      colorize(ctx, indices, maskImg.width, maskImg.height);
    };
    maskImg.src = maskSrc;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maskSrc]);

  // Re-colorize when hidden classes change (without reloading mask)
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas || !maskDataRef.current) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    colorize(ctx, maskDataRef.current, canvas.width, canvas.height);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenClasses, labels]);

  const colorize = useCallback(
    (ctx: CanvasRenderingContext2D, indices: Uint8Array, width: number, height: number) => {
      const imageData = ctx.createImageData(width, height);
      const data = imageData.data;

      for (let i = 0; i < indices.length; i++) {
        const classIdx = indices[i];
        const px = i * 4;

        if (classIdx === 255 || classIdx >= labels.length || hiddenClasses.has(classIdx)) {
          data[px] = 0;
          data[px + 1] = 0;
          data[px + 2] = 0;
          data[px + 3] = 0;
        } else {
          const color = labels[classIdx].color;
          data[px] = color[0];
          data[px + 1] = color[1];
          data[px + 2] = color[2];
          data[px + 3] = 255;
        }
      }

      ctx.putImageData(imageData, 0, 0);
    },
    [labels, hiddenClasses]
  );

  // Handle mouse move for hover tooltip
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onHover || !maskDataRef.current || !containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const { width, height } = dimensionsRef.current;
      if (width === 0 || height === 0) return;

      // Calculate the actual displayed image area (object-contain)
      const containerW = rect.width;
      const containerH = rect.height;
      const scale = Math.min(containerW / width, containerH / height);
      const displayW = width * scale;
      const displayH = height * scale;
      const offsetX = (containerW - displayW) / 2;
      const offsetY = (containerH - displayH) / 2;

      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Check if cursor is within the image area
      if (mouseX < offsetX || mouseX > offsetX + displayW || mouseY < offsetY || mouseY > offsetY + displayH) {
        onHover(null, e.clientX, e.clientY);
        return;
      }

      // Map to original image pixel coordinates
      const imgX = Math.floor(((mouseX - offsetX) / displayW) * width);
      const imgY = Math.floor(((mouseY - offsetY) / displayH) * height);
      const pixelIdx = imgY * width + imgX;

      if (pixelIdx >= 0 && pixelIdx < maskDataRef.current.length) {
        const classIdx = maskDataRef.current[pixelIdx];
        onHover(classIdx === 255 ? null : classIdx, e.clientX, e.clientY);
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
      <canvas
        ref={baseCanvasRef}
        className="absolute inset-0 w-full h-full object-contain"
      />
      <canvas
        ref={overlayCanvasRef}
        className="absolute inset-0 w-full h-full object-contain transition-opacity duration-150"
        style={{ opacity }}
      />
    </div>
  );
}
