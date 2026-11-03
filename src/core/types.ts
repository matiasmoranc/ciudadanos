export type ResourceId = 'wood' | 'stone' | 'iron' | 'gold' | 'food' | 'water';
export type Stock = Partial<Record<ResourceId, number>>;
export type Job = ResourceId | 'build' | 'reproduce';
export type BuildingType = 'house' | 'farm' | 'well' | 'depot' | 'barracks' | 'tower' | 'wallWood' | 'wallStone';
export type SoldierKind = 'common' | 'heavy';
export type Stance = 'defensive' | 'balanced' | 'aggressive';
export type NodeKind = 'tree' | 'rock' | 'bush' | 'water' | 'iron' | 'gold';
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
  /** Entre 0 y 1 mientras vuelve a crecer; 0 si no está creciendo. */
  growth: number;
  /** Sin acceso por una sequía o un derrumbe. */
  closed: 'dry' | 'rubble' | null;
  reopenAt: number;
}

/** Estado ambiental de una región: el círculo de influencia de un sitio. */
export interface RegionEco {
  /** Madera que tenía al empezar la partida. */
  trees: number;
  /** Nodos más cercanos a este sitio que a otro: los que le toca hacer rebrotar. */
  own: number[];
  /** Parte del bosque original que sigue en pie. */
  forest: number;
  moisture: number;
  drought: boolean;
  /** Agua extraída por minuto, suavizada. */
  thirst: number;
  drawn: number;
  regrow: number;
  bushes: number;
  /** Tensión del terreno por extraer piedra y metales. */
  strain: number;
  crack: Point | null;
  crackAt: number;
  /** El dueño ya tuvo un turno desde que aparecieron las grietas. */
  crackTurn: boolean;
  rubble: (Point & { until: number }) | null;
}

export interface Site extends Point {
  id: number;
  name: string;
  biome: Biome;
  specialty: Job[];
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
  /** Soldados que defienden la base. No están en el mapa hasta que salen. */
  garrison: Troops;
  wounds: number;
  training: { kind: SoldierKind; left: number }[];
  stance: Stance;
}

export interface Building extends Point {
  id: number;
  type: BuildingType;
  baseId: number;
  owner: number;
  progress: number;
  required: number;
  done: boolean;
  level: number;
  upgrading: boolean;
  users: number;
  /** Puesto en el anillo de muros; null para el resto de los edificios. */
  slot: number | null;
  hp: number;
  /** Fertilidad de una granja: baja con el uso intensivo y vuelve al descansar. */
  soil: number;
}

export interface Troops {
  common: number;
  heavy: number;
}

export type ArmyOrder =
  | { kind: 'move'; baseId: number }
  | { kind: 'retreat'; baseId: number }
  | { kind: 'attack'; baseId: number; mode: 'conquer' | 'raid' }
  | { kind: 'hold'; x: number; y: number }
  | { kind: 'chase'; armyId: number };

/** Grupo de soldados en el mapa: se mueve y pelea como una sola unidad. */
export interface Army extends Point, Troops {
  id: number;
  owner: number;
  wounds: number;
  order: ArmyOrder;
  path: Point[];
  leg: number;
  fighting: boolean;
  sieging: boolean;
  /** Segundos de saqueo o conquista acumulados. */
  progress: number;
  /** Base a la que vuelve después de una salida defensiva. */
  home: number | null;
}

export interface Shot {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  at: number;
}

/** Ciudadanos en camino a fundar una base. No pertenecen a ninguna base mientras viajan. */
export interface Expedition extends Point {
  id: number;
  owner: number;
  siteId: number;
  settlers: number;
  path: Point[];
  leg: number;
}

export interface Offer {
  id: number;
  from: number;
  /** null significa todos. */
  to: number | null;
  give: Stock;
  want: Stock;
  status: 'open' | 'accepted' | 'rejected';
  responses: Record<number, 'pending' | 'rejected'>;
  acceptedBy: number | null;
  counterOf: number | null;
  respondAt: number;
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
  | { kind: 'trade'; player: number; endsAt: number; botActAt: number; acted: boolean }
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
  eco: RegionEco[];
  players: Player[];
  bases: Base[];
  citizens: Citizen[];
  buildings: Building[];
  expeditions: Expedition[];
  armies: Army[];
  shots: Shot[];
  offers: Offer[];
  events: GameEvent[];
  warned: Record<string, number>;
  nextId: number;
}

export type Command =
  | { type: 'pickSite'; siteId: number }
  | { type: 'setJob'; baseId: number; job: Job; delta: number }
  | { type: 'setAutoSurvive'; baseId: number; value: boolean }
  | { type: 'build'; baseId: number; building: BuildingType }
  | { type: 'upgrade'; baseId: number; building: BuildingType }
  | { type: 'foundBase'; baseId: number; siteId: number }
  | { type: 'propose'; to: number | null; give: Stock; want: Stock }
  | { type: 'respond'; offerId: number; accept: boolean }
  | { type: 'counter'; offerId: number; give: Stock; want: Stock }
  | { type: 'market'; give: ResourceId; want: ResourceId }
  | { type: 'train'; baseId: number; kind: SoldierKind }
  | { type: 'setStance'; baseId: number; stance: Stance }
  | { type: 'sendArmy'; baseId: number; common: number; heavy: number; order: ArmyOrder }
  | { type: 'orderArmy'; armyId: number; order: ArmyOrder }
  | { type: 'retreat'; armyId: number }
  | { type: 'endTurn' };

export type CommandResult = { ok: true } | { ok: false; error: string };
