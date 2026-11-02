export type ResourceId = 'wood' | 'stone' | 'food' | 'water';
export type Job = 'wood' | 'stone' | 'food' | 'water' | 'build' | 'reproduce';
export type BuildingType = 'house' | 'farm' | 'well' | 'depot';
export type NodeKind = 'tree' | 'rock' | 'bush' | 'water';
export type Biome = 'forest' | 'mountain' | 'plains' | 'meadow' | 'fertile' | 'rocky';

export const enum Terrain {
  Ocean,
  Lake,
  River,
  Beach,
  Plains,
  Meadow,
  Fertile,
  Forest,
  Rocky,
  Mountain,
}

export interface Point {
  x: number;
  y: number;
}

export interface ResourceNode extends Point {
  id: number;
  kind: NodeKind;
  /** Cantidad restante; -1 significa inagotable. */
  amount: number;
  max: number;
  slots: number;
  /** Recalculado en cada tick: ciudadanos que apuntan a este nodo. */
  users: number;
}

export interface Site extends Point {
  id: number;
  name: string;
  biome: Biome;
  nodeIds: number[];
  stars: Record<ResourceId, number>;
  advantage: string;
  disadvantage: string;
}

export interface GameMap {
  seed: number;
  grid: number;
  cell: number;
  terrain: Uint8Array;
  elevation: Float32Array;
  sites: Site[];
  nodes: ResourceNode[];
  peaks: (Point & { size: number })[];
  paths: Point[][];
}

export interface Player {
  id: number;
  name: string;
  color: number;
  isBot: boolean;
  stock: Record<ResourceId, number>;
  /** Ticks seguidos con el recurso en cero. */
  shortage: { food: number; water: number };
  alive: boolean;
}

export interface Base extends Point {
  id: number;
  owner: number;
  siteId: number;
  name: string;
  /** Lo que pidió el jugador. */
  jobs: Record<Job, number>;
  /** Lo que se aplica, con la supervivencia automática incluida. */
  effective: Record<Job, number>;
  autoSurvive: boolean;
  crisis: { food: boolean; water: boolean };
  reproProgress: number;
}

export interface Building extends Point {
  id: number;
  type: BuildingType;
  baseId: number;
  owner: number;
  progress: number;
  required: number;
  done: boolean;
  users: number;
}

export type Target = { kind: 'node'; id: number } | { kind: 'building'; id: number };

export interface Citizen extends Point {
  id: number;
  baseId: number;
  owner: number;
  job: Job | 'idle';
  state: 'idle' | 'walk' | 'work';
  target: Target | null;
  dest: Point | null;
  /** Paso intermedio por el centro de la base para no cruzar agua. */
  via: Point | null;
  progress: number;
  wait: number;
}

export type Phase =
  | { kind: 'draft'; order: number[]; index: number; endsAt: number; botActAt: number }
  | { kind: 'decisions'; player: number; endsAt: number; botActAt: number }
  | { kind: 'over'; winner: number | null; reason: string };

export type ToastLevel = 'info' | 'warn' | 'bad' | 'good';

export interface GameEvent {
  player: number | null;
  text: string;
  level: ToastLevel;
}

export interface GameState {
  tick: number;
  rng: number;
  round: number;
  phase: Phase;
  map: GameMap;
  nodes: ResourceNode[];
  players: Player[];
  bases: Base[];
  citizens: Citizen[];
  buildings: Building[];
  events: GameEvent[];
  warned: Record<string, number>;
  nextId: number;
}

export type Command =
  | { type: 'pickSite'; siteId: number }
  | { type: 'setJob'; baseId: number; job: Job; delta: number }
  | { type: 'setAutoSurvive'; baseId: number; value: boolean }
  | { type: 'build'; baseId: number; building: BuildingType }
  | { type: 'endTurn' };

export type CommandResult = { ok: true } | { ok: false; error: string };
