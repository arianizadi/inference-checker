"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

interface LoadedMask {
  indices: Uint8Array;
  width: number;
  height: number;
}

interface MaskBundle {
  key: string;
  a: LoadedMask;
  b: LoadedMask;
  gt: LoadedMask;
}

const AGREE_CORRECT = [0, 200, 80];
const AGREE_WRONG = [255, 165, 0];
const DISAGREE = [220, 40, 40];

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
  const dimensionsRef = useRef({ width: 0, height: 0 });
  const masksRef = useRef<MaskBundle | null>(null);
  const [baseImage, setBaseImage] = useState<{ src: string; width: number; height: number } | null>(null);
  const [maskBundle, setMaskBundle] = useState<MaskBundle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const maskKey = `${maskSrcA}\n${maskSrcB}\n${gtMaskSrc}`;
  const currentBase = baseImage?.src === inputImageSrc ? baseImage : null;
  const currentMasks = maskBundle?.key === maskKey ? maskBundle : null;
  const dimensionError = currentBase && currentMasks &&
    [currentMasks.a, currentMasks.b, currentMasks.gt].some(
      (mask) => mask.width !== currentBase.width || mask.height !== currentBase.height,
    )
    ? `Dimension mismatch: input ${currentBase.width}x${currentBase.height}, A ${currentMasks.a.width}x${currentMasks.a.height}, B ${currentMasks.b.width}x${currentMasks.b.height}, GT ${currentMasks.gt.width}x${currentMasks.gt.height}`
    : null;

  const readMask = useCallback((src: string): Promise<LoadedMask> => {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) throw new Error("Browser could not create a mask canvas");
          context.drawImage(image, 0, 0);
          const rgba = context.getImageData(0, 0, image.width, image.height).data;
          const indices = new Uint8Array(image.width * image.height);
          for (let index = 0; index < indices.length; index++) {
            indices[index] = rgba[index * 4];
          }
          resolve({ indices, width: image.width, height: image.height });
        } catch (error) {
          reject(error);
        }
      };
      image.onerror = () => reject(new Error(`Could not load mask ${src}`));
      image.src = src;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const canvas = baseCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (cancelled) return;
      canvas.width = image.width;
      canvas.height = image.height;
      context.drawImage(image, 0, 0);
      dimensionsRef.current = { width: image.width, height: image.height };
      setBaseImage({ src: inputImageSrc, width: image.width, height: image.height });
    };
    image.onerror = () => {
      if (!cancelled) setLoadError(`Could not load input image ${inputImageSrc}`);
    };
    image.src = inputImageSrc;
    return () => {
      cancelled = true;
    };
  }, [inputImageSrc]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([readMask(maskSrcA), readMask(maskSrcB), readMask(gtMaskSrc)])
      .then(([a, b, gt]) => {
        if (cancelled) return;
        setMaskBundle({ key: maskKey, a, b, gt });
        setLoadError(null);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [gtMaskSrc, maskKey, maskSrcA, maskSrcB, readMask]);

  useEffect(() => {
    if (!currentBase || !currentMasks || dimensionError) return;
    const { a, b, gt } = currentMasks;

    const canvas = overlayCanvasRef.current;
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !context) return;
    canvas.width = a.width;
    canvas.height = a.height;
    const imageData = context.createImageData(a.width, a.height);
    for (let index = 0; index < a.indices.length; index++) {
      const classA = a.indices[index];
      const classB = b.indices[index];
      const classGT = gt.indices[index];
      const pixel = index * 4;
      if (
        classGT === 255 ||
        classGT >= numClasses ||
        (hiddenClasses.has(classGT) && hiddenClasses.has(classA) && hiddenClasses.has(classB))
      ) {
        imageData.data[pixel + 3] = 0;
        continue;
      }
      const color = classA === classB
        ? classA === classGT ? AGREE_CORRECT : AGREE_WRONG
        : DISAGREE;
      imageData.data[pixel] = color[0];
      imageData.data[pixel + 1] = color[1];
      imageData.data[pixel + 2] = color[2];
      imageData.data[pixel + 3] = 255;
    }
    context.putImageData(imageData, 0, 0);
    masksRef.current = currentMasks;
  }, [currentBase, currentMasks, dimensionError, hiddenClasses, numClasses]);

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const bundle = masksRef.current;
      if (!onHover || !bundle || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const { width, height } = dimensionsRef.current;
      if (width === 0 || height === 0) return;
      const scale = Math.min(rect.width / width, rect.height / height);
      const displayWidth = width * scale;
      const displayHeight = height * scale;
      const offsetX = (rect.width - displayWidth) / 2;
      const offsetY = (rect.height - displayHeight) / 2;
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      if (
        mouseX < offsetX || mouseX >= offsetX + displayWidth ||
        mouseY < offsetY || mouseY >= offsetY + displayHeight
      ) {
        onHover(null, event.clientX, event.clientY);
        return;
      }
      const imageX = Math.floor(((mouseX - offsetX) / displayWidth) * width);
      const imageY = Math.floor(((mouseY - offsetY) / displayHeight) * height);
      const pixel = imageY * width + imageX;
      const toClass = (value: number) => value === 255 || value >= numClasses ? null : value;
      onHover(
        {
          classA: toClass(bundle.a.indices[pixel]),
          classB: toClass(bundle.b.indices[pixel]),
          classGT: toClass(bundle.gt.indices[pixel]),
        },
        event.clientX,
        event.clientY,
      );
    },
    [numClasses, onHover],
  );

  return (
    <div
      ref={containerRef}
      className={`relative w-full aspect-[2/1] bg-black rounded-xl overflow-hidden ${className}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => onHover?.(null, 0, 0)}
    >
      <canvas ref={baseCanvasRef} className="absolute inset-0 w-full h-full object-contain" />
      <canvas
        ref={overlayCanvasRef}
        className="absolute inset-0 w-full h-full object-contain transition-opacity duration-150"
        style={{ opacity }}
      />
      {(loadError || dimensionError) && (
        <div className="absolute inset-x-4 bottom-4 rounded-lg border border-red-500/40 bg-black/90 p-3 text-sm text-red-200">
          {loadError || dimensionError}
        </div>
      )}
    </div>
  );
}
