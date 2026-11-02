import { isPassable, segmentPassable } from './mapgen';
import type { GameMap, Point } from './types';

/** Lado de la grilla de búsqueda, en celdas del mapa. */
const STEP = 2;
const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** Ruta por tierra entre dos puntos; los ríos se vadean, lagos y mar no. */
export function findPath(map: GameMap, from: Point, to: Point): Point[] | null {
  const size = Math.floor(map.grid / STEP);
  const unit = map.cell * STEP;
  const cellOf = (p: Point) => [Math.floor(p.x / unit), Math.floor(p.y / unit)];
  const center = (cx: number, cy: number) => ({ x: (cx + 0.5) * unit, y: (cy + 0.5) * unit });

  const [startX, startY] = cellOf(from);
  const [goalX, goalY] = cellOf(to);
  const start = startX + startY * size;
  const goal = goalX + goalY * size;
  const previous = new Int32Array(size * size).fill(-1);
  previous[start] = start;

  const queue = [start];
  for (let head = 0; head < queue.length && previous[goal] < 0; head++) {
    const current = queue[head];
    const cx = current % size;
    const cy = Math.floor(current / size);
    for (const [dx, dy] of NEIGHBORS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const next = nx + ny * size;
      if (previous[next] >= 0) continue;
      const p = center(nx, ny);
      if (next !== goal && !isPassable(map, p.x, p.y)) continue;
      previous[next] = current;
      queue.push(next);
    }
  }
  if (previous[goal] < 0) return null;

  const cells: Point[] = [];
  for (let at = goal; at !== start; at = previous[at]) {
    cells.unshift(center(at % size, Math.floor(at / size)));
  }
  return smooth(map, [from, ...cells, to]);
}

/** Quita puntos intermedios cuando se puede seguir en línea recta. */
function smooth(map: GameMap, points: Point[]): Point[] {
  const result = [points[0]];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let far = points.length - 1;
    while (far > anchor + 1 && !segmentPassable(map, points[anchor], points[far])) far--;
    result.push(points[far]);
    anchor = far;
  }
  return result;
}
