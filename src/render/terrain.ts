import { makeNoise } from '../core/rng';
import { WORLD_SIZE } from '../core/config';
import { Terrain } from '../core/types';
import type { GameMap } from '../core/types';
import { MAP_HEIGHT, MAP_WIDTH, TERRAIN_SCALE, toScreen, toWorld } from './iso';

type Rgb = [number, number, number];

const OCEAN: Rgb = [47, 134, 179];
const WET_SAND: Rgb = [226, 205, 150];
const CLIFF: Rgb = [132, 96, 66];
const FOAM: Rgb = [214, 240, 244];

const LAND_COLOR: Record<number, Rgb> = {
  [Terrain.Beach]: [238, 219, 164],
  [Terrain.Plains]: [173, 208, 106],
  [Terrain.Meadow]: [146, 210, 96],
  [Terrain.Fertile]: [112, 192, 82],
  [Terrain.Forest]: [76, 158, 76],
  [Terrain.Rocky]: [182, 172, 148],
  [Terrain.Mountain]: [146, 140, 134],
};

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function blur(field: Float32Array, size: number, passes: number): Float32Array {
  let current = field;
  for (let pass = 0; pass < passes; pass++) {
    const next = new Float32Array(field.length);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
            sum += current[nx + ny * size];
            count++;
          }
        }
        next[x + y * size] = sum / count;
      }
    }
    current = next;
  }
  return current;
}

/** Pinta el mapa en un único lienzo, sin casillas: cada píxel mezcla los campos del terreno. */
export function paintTerrain(map: GameMap): HTMLCanvasElement {
  const n = map.grid;
  const land = new Float32Array(n * n);
  const lake = new Float32Array(n * n);
  const red = new Float32Array(n * n);
  const green = new Float32Array(n * n);
  const blue = new Float32Array(n * n);

  for (let i = 0; i < n * n; i++) {
    const kind = map.terrain[i];
    land[i] = kind >= Terrain.Beach ? 1 : 0;
    lake[i] = kind === Terrain.Lake || kind === Terrain.River ? 1 : 0;
    const color = LAND_COLOR[kind] ?? LAND_COLOR[Terrain.Beach];
    red[i] = color[0];
    green[i] = color[1];
    blue[i] = color[2];
  }

  const landField = blur(land, n, 1);
  const lakeField = blur(lake, n, 2);
  const redField = blur(red, n, 3);
  const greenField = blur(green, n, 3);
  const blueField = blur(blue, n, 3);
  const heightField = blur(map.elevation, n, 3);

  const sample = (field: Float32Array, x: number, y: number) => {
    const gx = Math.max(0, Math.min(n - 1.001, x / map.cell - 0.5));
    const gy = Math.max(0, Math.min(n - 1.001, y / map.cell - 0.5));
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = gx - ix;
    const fy = gy - iy;
    const i = ix + iy * n;
    const top = field[i] * (1 - fx) + field[i + 1] * fx;
    const bottom = field[i + n] * (1 - fx) + field[i + n + 1] * fx;
    return top * (1 - fy) + bottom * fy;
  };

  const width = Math.ceil(MAP_WIDTH * TERRAIN_SCALE);
  const height = Math.ceil(MAP_HEIGHT * TERRAIN_SCALE);
  const worldAt = (px: number, py: number) => toWorld(px / TERRAIN_SCALE, py / TERRAIN_SCALE);
  const edge = (x: number, y: number) => x >= 0 && y >= 0 && x <= WORLD_SIZE && y <= WORLD_SIZE;
  const grain = makeNoise(map.seed + 9);

  const mask = new Float32Array(width * height);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const w = worldAt(px, py);
      mask[px + py * width] = edge(w.x, w.y) ? sample(landField, w.x, w.y) : 0;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(width, height);
  const data = image.data;

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const i = px + py * width;
      const value = mask[i];
      const w = worldAt(px, py);
      const inside = edge(w.x, w.y);
      let r: number;
      let g: number;
      let b: number;

      if (value > 0.5) {
        const patches = grain(w.x * 0.05, w.y * 0.05) - 0.5;
        const shade = inside
          ? (sample(heightField, w.x - 6, w.y - 6) - sample(heightField, w.x + 6, w.y + 6)) * 0.9
          : 0;
        const light = 1 + patches * 0.16 + Math.max(-0.22, Math.min(0.22, shade));
        r = sample(redField, w.x, w.y) * light;
        g = sample(greenField, w.x, w.y) * light;
        b = sample(blueField, w.x, w.y) * light;
        const shoreline = Math.min(1, (value - 0.5) * 8);
        r = mix(WET_SAND[0], r, shoreline);
        g = mix(WET_SAND[1], g, shoreline);
        b = mix(WET_SAND[2], b, shoreline);
      } else {
        const fresh = inside ? sample(lakeField, w.x, w.y) : 0;
        const cliffDepth = fresh > 0.05 ? 2 : 6;
        const above = py - cliffDepth >= 0 ? mask[i - cliffDepth * width] : 0;
        if (above > 0.5) {
          const fade = 0.75 + (py % 3) * 0.06;
          r = CLIFF[0] * fade;
          g = CLIFF[1] * fade;
          b = CLIFF[2] * fade;
        } else {
          const depth = Math.min(1, value * 2);
          const ripple = (grain(w.x * 0.03 + 40, w.y * 0.09) - 0.5) * 16;
          const freshness = Math.min(1, fresh * 3);
          r = mix(OCEAN[0], 86, freshness) + depth * 62 + ripple;
          g = mix(OCEAN[1], 188, freshness) + depth * 62 + ripple;
          b = mix(OCEAN[2], 216, freshness) + depth * 38 + ripple;
          if (value > 0.34) {
            const foam = (value - 0.34) * 5;
            r = mix(r, FOAM[0], foam);
            g = mix(g, FOAM[1], foam);
            b = mix(b, FOAM[2], foam);
          }
        }
      }

      const speck = (grain(px * 0.9, py * 0.9) - 0.5) * 6;
      const o = i * 4;
      data[o] = r + speck;
      data[o + 1] = g + speck;
      data[o + 2] = b + speck;
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  // Caminos naturales.
  ctx.scale(TERRAIN_SCALE, TERRAIN_SCALE);
  ctx.lineCap = 'round';
  ctx.setLineDash([26, 15]);
  for (const path of map.paths) {
    const [a, mid, b] = path.map((p) => toScreen(p.x, p.y));
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(mid.x, mid.y, b.x, b.y);
    ctx.strokeStyle = 'rgba(214, 188, 132, 0.34)';
    ctx.lineWidth = 7;
    ctx.stroke();
  }
  return canvas;
}
