export interface MenuPosition { left: number; top: number; maxHeight: number; maxWidth: number }
/** Uses measured content size and viewport coordinates, independent of scroll parents. */
export const menuPosition = (
  anchor: { left: number; top: number; bottom: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
): MenuPosition => {
  const margin = 12;
  const gap = 4;
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));
  const maxWidth = Math.max(0, viewport.width - margin * 2);
  const width = Math.min(menu.width, maxWidth);
  const anchorTop = clamp(anchor.top, margin, viewport.height - margin);
  const anchorBottom = clamp(anchor.bottom, margin, viewport.height - margin);
  const below = Math.max(0, viewport.height - margin - anchorBottom - gap);
  const above = Math.max(0, anchorTop - margin - gap);
  const useBelow = menu.height <= below || below >= above;
  const maxHeight = useBelow ? below : above;
  const height = Math.min(menu.height, maxHeight);
  return {
    left: clamp(anchor.left, margin, viewport.width - margin - width),
    top: clamp(useBelow ? anchorBottom + gap : anchorTop - gap - height, margin, viewport.height - margin - height),
    maxHeight,
    maxWidth,
  };
};
