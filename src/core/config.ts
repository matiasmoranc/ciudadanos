import type { Biome, BuildingType, Job, ResourceId, SoldierKind, Stance, Stock } from './types';

export const TICKS_PER_SECOND = 10;
export const seconds = (s: number) => Math.round(s * TICKS_PER_SECOND);

export const WORLD_SIZE = 1600;
export const BASE_RADIUS = 150;
/** Entre las bases iniciales: da tiempo a ver venir un ataque. */
export const START_BASE_DISTANCE = 280;
/** Para las bases que se fundan durante la partida. */
export const MIN_BASE_DISTANCE = 200;

export const MAX_POPULATION = 200;
export const START_CITIZENS = 2;
export const BASES_PER_PLAYER = 2;

export const TURN_SECONDS = 30;
export const DRAFT_SECONDS = 30;
export const TRADE_SECONDS = 30;
export const TOTAL_ROUNDS = 30;

export const RESOURCES: ResourceId[] = ['wood', 'stone', 'iron', 'food', 'water', 'gold'];
export const JOBS: Job[] = ['wood', 'stone', 'iron', 'gold', 'food', 'water', 'build', 'reproduce'];

export const RESOURCE_INFO: Record<ResourceId, { name: string; icon: string }> = {
  wood: { name: 'Madera', icon: '🪵' },
  stone: { name: 'Piedra', icon: '🪨' },
  iron: { name: 'Hierro', icon: '🔩' },
  food: { name: 'Comida', icon: '🍎' },
  water: { name: 'Agua', icon: '💧' },
  gold: { name: 'Oro', icon: '🪙' },
};

export const JOB_INFO: Record<Job, { name: string; icon: string }> = {
  wood: { name: 'Talar madera', icon: '🪓' },
  stone: { name: 'Extraer piedra', icon: '⛏️' },
  iron: { name: 'Extraer hierro', icon: '⚒️' },
  gold: { name: 'Buscar oro', icon: '🪙' },
  food: { name: 'Producir comida', icon: '🌾' },
  water: { name: 'Recolectar agua', icon: '💧' },
  build: { name: 'Construir', icon: '🔨' },
  reproduce: { name: 'Reproducción', icon: '❤️' },
};

export const START_STOCK: Record<ResourceId, number> = { wood: 60, stone: 30, iron: 0, food: 50, water: 50, gold: 0 };
export const BASE_STORAGE = 300;
export const DEPOT_STORAGE = 200;

/** Segundos de trabajo para producir una unidad. */
export const WORK_SECONDS = { wood: 8, stone: 10, iron: 12, gold: 16, forage: 9, farm: 6, water: 7 };

/** Las regiones rinden más en lo suyo. */
export const SPECIALTY_BONUS = 1.25;
export const REGION_SPECIALTY: Record<Biome, Job[]> = {
  forest: ['wood'],
  mountain: ['stone', 'iron'],
  rocky: ['gold'],
  plains: ['build'],
  meadow: ['food'],
  fertile: ['food', 'water'],
};

/** Consumo por persona y por minuto. */
export const CONSUMPTION_PER_MIN = 1.5;

export const WALK_SPEED = 18; // unidades de mundo por segundo
export const WORK_RANGE = 8;

export const BASE_HOUSING = 4;
export const HOUSE_CAPACITY = 8;

export const REPRODUCTION_SECONDS = 30;
export const BIRTH_COST = { food: 3, water: 1 };

export const SHORTAGE_PRODUCTIVITY = 0.6;
export const SHORTAGE_GRACE_SECONDS = 60;
export const SHORTAGE_DEATH_SECONDS = 12;
export const SHORTAGE_WARNING_SECONDS = 90;

export const SURVIVAL_LOW = 25;
export const SURVIVAL_OK = 40;
export const SURVIVAL_SHARE = 0.3;

export const WORKSITE_SLOTS = 3;
export const NODE_AMOUNT = { tree: 30, rock: 50, bush: 20, iron: 40, gold: 30 };
export const NODE_SLOTS = { tree: 1, rock: 2, bush: 1, water: 3, iron: 2, gold: 2 };

export interface BuildingInfo {
  name: string;
  icon: string;
  cost: Partial<Record<ResourceId, number>>;
  seconds: number;
  effect: string;
  footprint: number;
  hp?: number;
}

export const BUILDINGS: Record<BuildingType, BuildingInfo> = {
  house: {
    name: 'Casa',
    icon: '🏠',
    cost: { wood: 20, stone: 10 },
    seconds: 20,
    effect: `+${HOUSE_CAPACITY} de capacidad en esta base`,
    footprint: 24,
  },
  farm: {
    name: 'Granja',
    icon: '🌾',
    cost: { wood: 15, water: 10 },
    seconds: 15,
    effect: `${WORKSITE_SLOTS} puestos que producen más comida y usan agua`,
    footprint: 34,
  },
  well: {
    name: 'Pozo',
    icon: '🪣',
    cost: { stone: 20, wood: 10 },
    seconds: 15,
    effect: `${WORKSITE_SLOTS} puestos de agua en cualquier lugar`,
    footprint: 20,
  },
  depot: {
    name: 'Depósito',
    icon: '📦',
    cost: { wood: 25, stone: 15 },
    seconds: 20,
    effect: `+${DEPOT_STORAGE} de capacidad global`,
    footprint: 26,
  },
  barracks: {
    name: 'Cuartel',
    icon: '⚔️',
    cost: { wood: 40, stone: 30, iron: 10 },
    seconds: 25,
    effect: 'Permite entrenar soldados en esta base',
    footprint: 36,
  },
  tower: {
    name: 'Torre defensiva',
    icon: '🗼',
    cost: { stone: 30, wood: 15 },
    seconds: 25,
    effect: 'Dispara sola a los enemigos cercanos',
    footprint: 22,
    hp: 300,
  },
  wallWood: {
    name: 'Muro de madera',
    icon: '🧱',
    cost: { wood: 8 },
    seconds: 5,
    effect: 'Un tramo. Con el anillo completo hay que romperlo para entrar',
    footprint: 0,
    hp: 120,
  },
  wallStone: {
    name: 'Muro de piedra',
    icon: '🧱',
    cost: { stone: 12 },
    seconds: 8,
    effect: 'Un tramo más resistente',
    footprint: 0,
    hp: 300,
  },
};

export const RING_RADIUS = 112;
export const RING_SLOTS = 12;
export const SIEGE_RANGE = 48;
export const TOWER_DAMAGE = 14;
export const TOWER_RANGE = 130;

/** Sin ataques al principio: nadie pierde una base antes de armar su economía. */
export const TRUCE_ROUNDS = 5;
export const RAID_SECONDS = 12;
export const CONQUER_SECONDS = 30;
export const LOOT_SHARE = 0.2;
export const LOOT_PER_SOLDIER = 8;
export const LOOT_MAX = 60;

export interface SoldierInfo {
  name: string;
  hp: number;
  attack: number;
  defense: number;
  /** Unidades por segundo: lentas a propósito para poder ver venir un ataque. */
  speed: number;
  cost: Stock;
  seconds: number;
}

export const SOLDIERS: Record<SoldierKind, SoldierInfo> = {
  common: {
    name: 'Soldado común',
    hp: 40,
    attack: 6,
    defense: 2,
    speed: 5,
    cost: { iron: 5, food: 10 },
    seconds: 15,
  },
  heavy: {
    name: 'Soldado pesado',
    hp: 90,
    attack: 11,
    defense: 6,
    speed: 3.8,
    cost: { iron: 12, food: 15, gold: 5 },
    seconds: 25,
  },
};

export const STANCE_INFO: Record<Stance, string> = {
  defensive: 'Defensiva',
  balanced: 'Equilibrada',
  aggressive: 'Agresiva',
};

/** Hasta qué distancia salen a buscar enemigos los defensores de una base. */
export const STANCE_RADIUS: Record<Stance, number> = { defensive: 0, balanced: 170, aggressive: 300 };

export interface UpgradeInfo {
  name: string;
  cost: Stock;
  seconds: number;
  effect: string;
}

export const HOUSE_UPGRADE_CAPACITY = 4;
export const FARM_UPGRADE_SECONDS = 4;
export const WELL_UPGRADE_SLOTS = 2;
export const DEPOT_UPGRADE_STORAGE = 150;

export const UPGRADES: Partial<Record<BuildingType, UpgradeInfo>> = {
  house: {
    name: 'Casa reforzada',
    cost: { wood: 20, iron: 10 },
    seconds: 15,
    effect: `+${HOUSE_UPGRADE_CAPACITY} de capacidad en esta casa`,
  },
  farm: {
    name: 'Granja con riego',
    cost: { wood: 15, iron: 8 },
    seconds: 12,
    effect: 'Sus trabajadores producen 50 % más',
  },
  well: {
    name: 'Pozo profundo',
    cost: { stone: 15, iron: 8 },
    seconds: 12,
    effect: `+${WELL_UPGRADE_SLOTS} puestos de trabajo`,
  },
  depot: {
    name: 'Gran depósito',
    cost: { stone: 20, iron: 10, gold: 5 },
    seconds: 15,
    effect: `+${DEPOT_UPGRADE_STORAGE} de capacidad global`,
  },
};

export const EXPEDITION_COST: Stock = { wood: 60, stone: 40, food: 20 };
export const EXPEDITION_SETTLERS = 3;

/** Precio de referencia de cada recurso en el mercado neutral. */
export const MARKET_VALUE: Record<ResourceId, number> = { wood: 1, stone: 1, food: 1, water: 1, iron: 3, gold: 5 };
export const MARKET_SPREAD = 2;
export const MARKET_LOT = 5;

// ---- Ecosistema ------------------------------------------------------------

export const ECO_STEP_SECONDS = 5;

/** Por debajo de esta parte del bosque la región empieza a sufrir. */
export const FOREST_THIN = 0.5;
export const FOREST_BARE = 0.2;
/** Con menos madera que esto la región no cuenta como boscosa. */
export const MIN_FOREST_WOOD = 180;
/** Segundos entre un árbol nuevo y el siguiente en cada región. */
export const REGROW_SECONDS = { healthy: 120, thin: 300, bare: 600 };
export const SAPLING_SECONDS = 150;
export const BUSH_REGROW_SECONDS = 150;
export const BUSH_GROWTH_SECONDS = 60;

export const MOISTURE_DOWN_SECONDS = 300;
export const MOISTURE_UP_SECONDS = 240;
export const DRYING_LEVEL = 0.6;
export const DROUGHT_START = 0.4;
export const DROUGHT_END = 0.55;
/** Agua por minuto que una región soporta sin resecarse. */
export const THIRST_BASE = 24;
export const THIRST_PER_SHORE = 6;
export const THIRST_MAX = 60;

/** Agua que usa una granja por cada unidad de comida. */
export const FARM_WATER = 0.25;
export const SOIL_MIN = 0.5;
export const SOIL_TIRED = 0.7;
export const SOIL_TIRE_SECONDS = 360;
export const SOIL_REST_SECONDS = 180;

export const UNSTABLE_BIOMES: Biome[] = ['mountain', 'rocky'];
export const MINING_JOBS: Job[] = ['stone', 'iron', 'gold'];
/** Con esta gente picando, el terreno aguanta sin límite. */
export const SAFE_MINERS = 2;
export const STRAIN_DECAY_PER_MIN = 12;
export const STRAIN_LIMIT = 120;
export const STRAIN_AFTER = 50;
export const CRACK_SECONDS = 90;
export const RUBBLE_SECONDS = 120;
export const COLLAPSE_RADIUS = 70;
export const COLLAPSE_DEATHS = 2;

export const SCORE = { citizen: 2, soldier: 2, building: 5, base: 10, upgrade: 3 };
