import { BASE_RADIUS, NODE_AMOUNT, NODE_SLOTS, REGION_SPECIALTY, RESOURCE_INFO, WORLD_SIZE } from './config';
import { makeNoise, makeRng } from './rng';
import { Terrain } from './types';
import type { Biome, GameMap, NodeKind, Point, ResourceId, ResourceNode, Site } from './types';

const GRID = 400;
const CELL = WORLD_SIZE / GRID;
const CENTER = WORLD_SIZE / 2;
/** Escala de las formas del mapa respecto del mundo de referencia de 1000. */
const SCALE = WORLD_SIZE / 1000;

const REGION_SPACING = 235;
const SITE_CLEARANCE = 75;
/** Separación de la grilla de siembra: más grande, menos cargado de árboles. */
const SEED_STEP = 18;

const BIOME_BAG: Biome[] = [
  'forest', 'plains', 'mountain', 'meadow', 'forest', 'rocky',
  'plains', 'fertile', 'forest', 'mountain', 'plains', 'forest',
  'meadow', 'rocky', 'fertile', 'plains', 'mountain', 'forest',
];

const SITE_NAMES: Record<Biome, string[]> = {
  forest: ['Base del Bosque', 'Base del Pinar', 'Base de la Arboleda', 'Base del Robledal', 'Base del Monte'],
  plains: ['Base de la Llanura', 'Base del Llano', 'Base de la Pampa', 'Base del Campo'],
  mountain: ['Base de la Montaña', 'Base de la Cumbre', 'Base del Risco'],
  meadow: ['Base de la Pradera', 'Base del Prado'],
  fertile: ['Base del Valle', 'Base de la Vega'],
  rocky: ['Base de la Cantera', 'Base del Pedregal'],
};

const BIOME_TERRAIN: Record<Biome, Terrain> = {
  forest: Terrain.Forest,
  plains: Terrain.Plains,
  mountain: Terrain.Mountain,
  meadow: Terrain.Meadow,
  fertile: Terrain.Fertile,
  rocky: Terrain.Rocky,
};

/** Probabilidad de que un intento de siembra deje cada nodo, por terreno. */
const DENSITY: Partial<Record<Terrain, Partial<Record<NodeKind, number>>>> = {
  [Terrain.Forest]: { tree: 0.68, bush: 0.14, rock: 0.03 },
  [Terrain.Meadow]: { bush: 0.34, tree: 0.1 },
  [Terrain.Fertile]: { bush: 0.42, tree: 0.06 },
  [Terrain.Plains]: { bush: 0.16, tree: 0.08, rock: 0.04, iron: 0.01 },
  [Terrain.Rocky]: { rock: 0.3, gold: 0.09, iron: 0.05, bush: 0.03, tree: 0.05 },
  [Terrain.Mountain]: { rock: 0.42, iron: 0.14, gold: 0.03, tree: 0.08, bush: 0.03 },
  [Terrain.Beach]: { bush: 0.02 },
};

const STAR_THRESHOLDS: Record<ResourceId, number[]> = {
  wood: [250, 450, 900, 1700],
  stone: [200, 500, 1500, 2500],
  iron: [30, 80, 300, 650],
  food: [120, 300, 600, 1000],
  water: [1, 2, 4, 7],
  gold: [20, 60, 200, 400],
};

const cellIndex = (x: number, y: number) => {
  const cx = Math.max(0, Math.min(GRID - 1, Math.floor(x / CELL)));
  const cy = Math.max(0, Math.min(GRID - 1, Math.floor(y / CELL)));
  return cx + cy * GRID;
};

export function terrainAt(map: GameMap, x: number, y: number): Terrain {
  return map.terrain[cellIndex(x, y)] as Terrain;
}

export function isLand(map: GameMap, x: number, y: number): boolean {
  return terrainAt(map, x, y) >= Terrain.Beach;
}

/** A pie se vadean los ríos; solo el mar y los lagos cortan el paso. */
export function isPassable(map: GameMap, x: number, y: number): boolean {
  const kind = terrainAt(map, x, y);
  return kind !== Terrain.Ocean && kind !== Terrain.Lake;
}

export function segmentPassable(map: GameMap, a: Point, b: Point): boolean {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(dist / (CELL * 0.8)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!isPassable(map, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
  }
  return true;
}

export function segmentClear(map: GameMap, a: Point, b: Point): boolean {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(dist / (CELL * 0.8)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!isLand(map, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
  }
  return true;
}

function starsFor(resource: ResourceId, value: number): number {
  return 1 + STAR_THRESHOLDS[resource].filter((limit) => value >= limit).length;
}

export function generateMap(seed: number): GameMap {
  const rng = makeRng(seed);
  const coastNoise = makeNoise(seed + 1);
  const warpX = makeNoise(seed + 2);
  const warpY = makeNoise(seed + 3);
  const lakeNoise = makeNoise(seed + 4);
  const hillNoise = makeNoise(seed + 5);

  const terrain = new Uint8Array(GRID * GRID);
  const elevation = new Float32Array(GRID * GRID);
  const coast = new Float32Array(GRID * GRID);

  const coastAt = (x: number, y: number) => {
    const d = Math.hypot(x - CENTER, y - CENTER) / (470 * SCALE);
    return 1 - (d + (coastNoise((x * 0.006) / SCALE, (y * 0.006) / SCALE) - 0.5) * 0.55);
  };

  for (let cy = 0; cy < GRID; cy++) {
    for (let cx = 0; cx < GRID; cx++) {
      coast[cx + cy * GRID] = coastAt((cx + 0.5) * CELL, (cy + 0.5) * CELL);
    }
  }

  // Regiones: cada una es un bioma y un sitio posible para una base.
  const seeds: Point[] = [];
  for (let tries = 0; tries < 6000 && seeds.length < BIOME_BAG.length; tries++) {
    const p = { x: rng() * WORLD_SIZE, y: rng() * WORLD_SIZE };
    if (coastAt(p.x, p.y) < 0.14) continue;
    if (seeds.some((s) => Math.hypot(s.x - p.x, s.y - p.y) < REGION_SPACING)) continue;
    seeds.push(p);
  }

  // Reparte la bolsa evitando repetir el bioma de las regiones vecinas.
  const bag = BIOME_BAG.slice(0, seeds.length);
  const biomes: Biome[] = [];
  seeds.forEach((seedPoint, i) => {
    const neighbors = seeds
      .slice(0, i)
      .map((s, j) => ({ d: Math.hypot(s.x - seedPoint.x, s.y - seedPoint.y), biome: biomes[j] }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
      .map((n) => n.biome);
    let pick = 0;
    let best = Infinity;
    bag.forEach((biome, index) => {
      const repeats = neighbors.filter((n) => n === biome).length;
      if (repeats < best) {
        best = repeats;
        pick = index;
      }
    });
    biomes.push(bag.splice(pick, 1)[0]);
  });

  for (let cy = 0; cy < GRID; cy++) {
    for (let cx = 0; cx < GRID; cx++) {
      const i = cx + cy * GRID;
      const x = (cx + 0.5) * CELL;
      const y = (cy + 0.5) * CELL;
      if (coast[i] <= 0) {
        terrain[i] = Terrain.Ocean;
        continue;
      }
      if (coast[i] < 0.035) {
        terrain[i] = Terrain.Beach;
        continue;
      }
      const wx = x + (warpX((x * 0.008) / SCALE, (y * 0.008) / SCALE) - 0.5) * 170 * SCALE;
      const wy = y + (warpY((x * 0.008) / SCALE, (y * 0.008) / SCALE) - 0.5) * 170 * SCALE;
      let nearest = 0;
      let best = Infinity;
      seeds.forEach((s, index) => {
        const d = (s.x - wx) ** 2 + (s.y - wy) ** 2;
        if (d < best) {
          best = d;
          nearest = index;
        }
      });
      const biome = biomes[nearest];
      terrain[i] = BIOME_TERRAIN[biome];
      const lift = biome === 'mountain' ? 1 : biome === 'rocky' ? 0.5 : 0.12;
      elevation[i] = lift * (0.45 + hillNoise((x * 0.02) / SCALE, (y * 0.02) / SCALE) * 0.9);
    }
  }

  const nearSeed = (x: number, y: number, limit: number) =>
    seeds.some((s) => Math.hypot(s.x - x, s.y - y) < limit);

  const carve = (x: number, y: number, radius: number, kind: Terrain) => {
    const reach = Math.ceil(radius / CELL) + 1;
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
        const px = (nx + 0.5) * CELL;
        const py = (ny + 0.5) * CELL;
        if (Math.hypot(px - x, py - y) > radius) continue;
        const i = nx + ny * GRID;
        if (terrain[i] !== Terrain.Ocean) terrain[i] = kind;
      }
    }
  };

  // Lagos entre regiones.
  const lakes: Point[] = [];
  for (let tries = 0; tries < 1200 && lakes.length < 7; tries++) {
    const a = seeds[Math.floor(rng() * seeds.length)];
    const b = seeds[Math.floor(rng() * seeds.length)];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (a === b || d > 420) continue;
    const p = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (nearSeed(p.x, p.y, 95) || coastAt(p.x, p.y) < 0.1) continue;
    if (lakes.some((l) => Math.hypot(l.x - p.x, l.y - p.y) < 240)) continue;
    lakes.push(p);
    const radius = 34 + rng() * 26;
    for (let i = 0; i < 14; i++) {
      const angle = (i / 14) * Math.PI * 2;
      const r = radius * (0.5 + lakeNoise(p.x * 0.05 + i, p.y * 0.05) * 0.5);
      carve(p.x + Math.cos(angle) * r * 0.7, p.y + Math.sin(angle) * r * 0.7, radius * 0.72, Terrain.Lake);
    }
  }

  // Ríos: nacen en las montañas y bajan hasta la costa esquivando los sitios.
  const sources = seeds.filter((_, i) => biomes[i] === 'mountain');
  sources.forEach((source) => {
    const away = Math.atan2(source.y - CENTER, source.x - CENTER);
    let heading = away + (rng() - 0.5) * 1.6;
    let x = source.x + Math.cos(heading) * 50;
    let y = source.y + Math.sin(heading) * 50;
    let width = 5;
    for (let step = 0; step < 200; step++) {
      if (coastAt(x, y) <= 0) break;
      carve(x, y, width, Terrain.River);
      width = Math.min(10, width + 0.06);
      const bend = (warpX((x * 0.012) / SCALE, (y * 0.012) / SCALE) - 0.5) * 1.6;
      const seaward = Math.atan2(y - CENTER, x - CENTER);
      heading += (seaward - heading) * 0.12 + bend * 0.25;
      const close = seeds.find((s) => Math.hypot(s.x - x, s.y - y) < 85);
      if (close) heading += Math.sign(Math.sin(Math.atan2(close.y - y, close.x - x) - heading)) * -0.7;
      x += Math.cos(heading) * 8;
      y += Math.sin(heading) * 8;
    }
  });

  // Los sitios siempre quedan sobre tierra firme.
  seeds.forEach((s) => {
    const radius = 3;
    const cx = Math.floor(s.x / CELL);
    const cy = Math.floor(s.y / CELL);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const i = cx + dx + (cy + dy) * GRID;
        if (terrain[i] < Terrain.Beach) terrain[i] = Terrain.Plains;
      }
    }
  });

  // Nodos de recursos.
  const nodes: ResourceNode[] = [];
  const addNode = (kind: NodeKind, x: number, y: number) => {
    const amount = kind === 'water' ? -1 : NODE_AMOUNT[kind];
    nodes.push({ id: nodes.length, kind, x, y, amount, max: amount, slots: NODE_SLOTS[kind], users: 0, growth: 0, closed: null, reopenAt: 0 });
  };
  for (let gy = SEED_STEP; gy < WORLD_SIZE; gy += SEED_STEP) {
    for (let gx = SEED_STEP; gx < WORLD_SIZE; gx += SEED_STEP) {
      const x = gx + (rng() - 0.5) * SEED_STEP * 0.85;
      const y = gy + (rng() - 0.5) * SEED_STEP * 0.85;
      const roll = rng();
      if (!isLandCell(terrain, x, y) || nearSeed(x, y, SITE_CLEARANCE)) continue;
      const kindHere = terrain[cellIndex(x, y)] as Terrain;
      const table = DENSITY[kindHere];
      if (!table) continue;
      // Los bosques dejan claros para que el mapa se pueda leer.
      if (kindHere === Terrain.Forest && lakeNoise(x * 0.012, y * 0.012) < 0.47) continue;
      let acc = 0;
      for (const kind of ['tree', 'rock', 'bush', 'iron', 'gold'] as NodeKind[]) {
        acc += table[kind] ?? 0;
        if (roll < acc) {
          addNode(kind, x, y);
          break;
        }
      }
    }
  }

  // Orillas de agua dulce.
  const shore: Point[] = [];
  for (let cy = 1; cy < GRID - 1; cy++) {
    for (let cx = 1; cx < GRID - 1; cx++) {
      const i = cx + cy * GRID;
      if (terrain[i] < Terrain.Beach) continue;
      const touches = [i - 1, i + 1, i - GRID, i + GRID].some(
        (n) => terrain[n] === Terrain.Lake || terrain[n] === Terrain.River,
      );
      if (!touches) continue;
      const p = { x: (cx + 0.5) * CELL, y: (cy + 0.5) * CELL };
      if (shore.some((s) => Math.hypot(s.x - p.x, s.y - p.y) < 32)) continue;
      shore.push(p);
      addNode('water', p.x, p.y);
    }
  }

  const map: GameMap = {
    seed,
    grid: GRID,
    cell: CELL,
    terrain,
    elevation,
    sites: [],
    nodes,
    peaks: [],
    paths: [],
  };

  const usedNames: Partial<Record<Biome, number>> = {};
  map.sites = seeds.map((s, id) => {
    const biome = biomes[id];
    const nameIndex = usedNames[biome] ?? 0;
    usedNames[biome] = nameIndex + 1;
    const nodeIds = nodes
      .filter((n) => Math.hypot(n.x - s.x, n.y - s.y) <= BASE_RADIUS && segmentClear(map, s, n))
      .map((n) => n.id);
    const site: Site = {
      id,
      x: s.x,
      y: s.y,
      biome,
      specialty: REGION_SPECIALTY[biome],
      name: SITE_NAMES[biome][nameIndex % SITE_NAMES[biome].length],
      nodeIds,
      ...rateSite(nodes, nodeIds),
    };
    return site;
  });

  // Cumbres decorativas, lejos de los sitios para no tapar las bases.
  for (let tries = 0; tries < 1400; tries++) {
    const x = rng() * WORLD_SIZE;
    const y = rng() * WORLD_SIZE;
    if (terrainAt(map, x, y) !== Terrain.Mountain || nearSeed(x, y, 125)) continue;
    if (map.peaks.some((p) => Math.hypot(p.x - x, p.y - y) < 80)) continue;
    map.peaks.push({ x, y, size: 0.7 + rng() * 0.6 });
  }

  // Caminos naturales entre sitios vecinos con paso por tierra.
  map.sites.forEach((a, i) => {
    map.sites.slice(i + 1).forEach((b) => {
      if (Math.hypot(a.x - b.x, a.y - b.y) > 420 || !segmentClear(map, a, b)) return;
      const bend = (rng() - 0.5) * 90;
      map.paths.push([
        a,
        { x: (a.x + b.x) / 2 + bend, y: (a.y + b.y) / 2 - bend },
        b,
      ]);
    });
  });

  return map;
}

function isLandCell(terrain: Uint8Array, x: number, y: number) {
  return terrain[cellIndex(x, y)] >= Terrain.Beach;
}

function rateSite(nodes: ResourceNode[], nodeIds: number[]) {
  const totals: Record<ResourceId, number> = { wood: 0, stone: 0, iron: 0, gold: 0, food: 0, water: 0 };
  nodeIds.forEach((id) => {
    const node = nodes[id];
    if (node.kind === 'tree') totals.wood += node.amount;
    if (node.kind === 'rock') totals.stone += node.amount;
    if (node.kind === 'bush') totals.food += node.amount;
    if (node.kind === 'water') totals.water += 1;
    if (node.kind === 'iron') totals.iron += node.amount;
    if (node.kind === 'gold') totals.gold += node.amount;
  });
  const stars = {
    wood: starsFor('wood', totals.wood),
    stone: starsFor('stone', totals.stone),
    iron: starsFor('iron', totals.iron),
    food: starsFor('food', totals.food),
    water: starsFor('water', totals.water),
    gold: starsFor('gold', totals.gold),
  };
  const ranked = (Object.keys(stars) as ResourceId[]).sort((a, b) => stars[b] - stars[a]);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  return {
    stars,
    advantage: `producción de ${RESOURCE_INFO[best].name.toLowerCase()} elevada.`,
    disadvantage:
      worst === 'water' && totals.water === 0
        ? 'sin agua cerca: vas a necesitar un pozo.'
        : `poca disponibilidad de ${RESOURCE_INFO[worst].name.toLowerCase()}.`,
  };
}
