export const ICON_SIZE = 64;
export const ICON_GAP = 16;
export const ICON_LABEL_HEIGHT = 16;
const ROW_HEIGHT = ICON_SIZE + ICON_LABEL_HEIGHT + ICON_GAP;

export function galleryLayout(count: number, width: number, height: number, scrollTop: number) {
  const columns = Math.max(1, Math.floor((width + ICON_GAP) / (ICON_SIZE + ICON_GAP)));
  const rows = Math.ceil(count / columns);
  const firstRow = Math.max(
    0,
    Math.min(Math.max(0, rows - 1), Math.floor(scrollTop / ROW_HEIGHT) - 1),
  );
  const visibleRows = Math.max(1, Math.ceil(height / ROW_HEIGHT)) + 3;
  return {
    start: Math.min(count, firstRow * columns),
    end: Math.min(count, (firstRow + visibleRows) * columns),
    translateY: firstRow * ROW_HEIGHT,
    totalHeight: Math.max(0, rows * ROW_HEIGHT - ICON_GAP),
  };
}
