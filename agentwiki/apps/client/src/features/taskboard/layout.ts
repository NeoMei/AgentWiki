export const ROOT_COLUMN_WIDTH = 280;
export const COLUMN_WIDTH = 245;
export const COLUMN_GAP = 32;
export const GRAPH_PADDING = 24;
const NODE_GAP = 16;
export interface MeasuredColumn { ids: string[]; heights: number[] }
export interface TaskboardLayout { h: number; width: number; tops: Record<string, number>; wires: string[] }

/** Pure screen geometry. Heights come exclusively from the current rendered DOM. */
export function layoutTaskboardColumns(columns: MeasuredColumn[], path: string[]): TaskboardLayout {
  const tops: Record<string, number> = {};
  const heights: Record<string, number> = {};
  const columnWidth = columns.length === 1 ? ROOT_COLUMN_WIDTH : COLUMN_WIDTH;
  let minTop = 0;
  let maxBottom = 0;
  columns.forEach((column, ci) => {
    const groupHeight = column.heights.reduce((sum, height) => sum + height, 0) + Math.max(0, column.ids.length - 1) * NODE_GAP;
    const parentKey = `${ci - 1}:${path[ci - 1]}`;
    const center = ci > 0 && tops[parentKey] !== undefined ? tops[parentKey] + heights[parentKey] / 2 : 0;
    let y = center - groupHeight / 2;
    column.ids.forEach((id, index) => {
      const key = `${ci}:${id}`;
      tops[key] = y;
      heights[key] = column.heights[index];
      minTop = Math.min(minTop, y);
      maxBottom = Math.max(maxBottom, y + heights[key]);
      y += heights[key] + NODE_GAP;
    });
  });
  const h = Math.max(580, maxBottom - minTop + GRAPH_PADDING * 2);
  const shift = (h - (maxBottom - minTop)) / 2 - minTop;
  for (const key of Object.keys(tops)) tops[key] += shift;
  const wires: string[] = [];
  for (let ci = 1; ci < columns.length; ci += 1) {
    const fromKey = `${ci - 1}:${path[ci - 1]}`;
    if (tops[fromKey] === undefined) continue;
    const fromX = GRAPH_PADDING + (ci - 1) * (columnWidth + COLUMN_GAP) + columnWidth;
    const fromY = tops[fromKey] + heights[fromKey] / 2;
    const toX = GRAPH_PADDING + ci * (columnWidth + COLUMN_GAP);
    columns[ci].ids.forEach(id => {
      const toKey = `${ci}:${id}`;
      wires.push(`M${fromX} ${fromY}H${(fromX + toX) / 2}V${tops[toKey] + heights[toKey] / 2}H${toX}`);
    });
  }
  return { h, width: Math.max(960, GRAPH_PADDING * 2 + columns.length * columnWidth + Math.max(0, columns.length - 1) * COLUMN_GAP), tops, wires };
}
