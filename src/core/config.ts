import type { Biome, BuildingType, Job, ResourceId, Stock } from './types';

export const TICKS_PER_SECOND = 10;
export const seconds = (s: number) => Math.round(s * TICKS_PER_SECOND);

export const WORLD_SIZE = 1000;
export const BASE_RADIUS = 130;
export const MIN_BASE_DISTANCE = 165;

export const MAX_POPULATION = 200;
export const START_CITIZENS = 2;
export const BASES_PER_PLAYER = 2;

export const TURN_SECONDS = 30;
export const DRAFT_SECONDS = 30;
export const TRADE_SECONDS = 30;
export const TOTAL_ROUNDS = 24;

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
export const NODE_AMOUNT = { tree: 20, rock: 40, bush: 15, iron: 30, gold: 20 };
export const NODE_SLOTS = { tree: 1, rock: 2, bush: 1, water: 3, iron: 2, gold: 2 };

export interface BuildingInfo {
  name: string;
  icon: string;
  cost: Partial<Record<ResourceId, number>>;
  seconds: number;
  effect: string;
  footprint: number;
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
    effect: `${WORKSITE_SLOTS} puestos que producen más comida`,
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
};

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

export const UPGRADES: Record<BuildingType, UpgradeInfo> = {
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

export const SCORE = { citizen: 2, building: 5, base: 10, upgrade: 3 };
