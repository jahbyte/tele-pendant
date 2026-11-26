export type ImageRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** object-fit: contain rectangle inside a frame. Percents use this box. */
export function containedImageRect(
  frameWidth: number,
  frameHeight: number,
  imageWidth: number,
  imageHeight: number,
): ImageRect {
  if (
    frameWidth <= 0 ||
    frameHeight <= 0 ||
    imageWidth <= 0 ||
    imageHeight <= 0
  ) {
    return {
      left: 0,
      top: 0,
      width: Math.max(frameWidth, 0),
      height: Math.max(frameHeight, 0),
    };
  }
  const scale = Math.min(frameWidth / imageWidth, frameHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    left: (frameWidth - width) / 2,
    top: (frameHeight - height) / 2,
    width,
    height,
  };
}

export function percentInRect(
  localX: number,
  localY: number,
  rect: ImageRect,
): { xPct: number; yPct: number } {
  const x = rect.width > 0 ? (localX / rect.width) * 100 : 0;
  const y = rect.height > 0 ? (localY / rect.height) * 100 : 0;
  return {
    xPct: Math.round(Math.min(100, Math.max(0, x)) * 10) / 10,
    yPct: Math.round(Math.min(100, Math.max(0, y)) * 10) / 10,
  };
}

/**
 * Top-left origin for a chip on the plant stage, clamped so the whole chip
 * stays inside the drawn picture (phones clip with overflow:hidden).
 */
export function clampPercentOrigin(
  xPct: number,
  yPct: number,
  stageWidth: number,
  stageHeight: number,
  chipWidth: number,
  chipHeight: number,
): { leftPct: number; topPct: number } {
  const maxLeftPct =
    stageWidth > 0 && chipWidth > 0
      ? Math.max(0, (1 - chipWidth / stageWidth) * 100)
      : 100;
  const maxTopPct =
    stageHeight > 0 && chipHeight > 0
      ? Math.max(0, (1 - chipHeight / stageHeight) * 100)
      : 100;
  const clamp = (value: number, max: number) =>
    Math.round(Math.min(max, Math.max(0, value)) * 10) / 10;
  return {
    leftPct: clamp(xPct, maxLeftPct),
    topPct: clamp(yPct, maxTopPct),
  };
}

/** Picture stage under a fixed chrome band (title + status). */
export function plantStageBelowChrome(
  frame: ImageRect,
  chromeHeight: number,
): ImageRect {
  const top = Math.max(0, chromeHeight);
  const height = Math.max(0, frame.height - top);
  return {
    left: frame.left,
    top: frame.top + top,
    width: frame.width,
    height,
  };
}
