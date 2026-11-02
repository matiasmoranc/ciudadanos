import { WORLD_SIZE } from '../core/config';
import type { Point } from '../core/types';

const SCALE_X = 0.9;
const SCALE_Y = 0.45;
const MARGIN = 100;

export const MAP_WIDTH = WORLD_SIZE * SCALE_X * 2 + MARGIN * 2;
export const MAP_HEIGHT = WORLD_SIZE * SCALE_Y * 2 + MARGIN * 2;

/** Proyección isométrica: del mundo plano a la pantalla. */
export function toScreen(x: number, y: number): Point {
  return {
    x: (x - y) * SCALE_X + WORLD_SIZE * SCALE_X + MARGIN,
    y: (x + y) * SCALE_Y + MARGIN,
  };
}

export function toWorld(sx: number, sy: number): Point {
  const a = (sx - MARGIN - WORLD_SIZE * SCALE_X) / SCALE_X;
  const b = (sy - MARGIN) / SCALE_Y;
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/** Radios en pantalla del círculo de influencia de una base. */
export function ellipseOf(radius: number) {
  return { rx: radius * SCALE_X * Math.SQRT2, ry: radius * SCALE_Y * Math.SQRT2 };
}
