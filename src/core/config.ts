import type { BuildingType, Job, ResourceId } from './types';

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
export const TOTAL_ROUNDS = 24;

export const RESOURCES: ResourceId[] = ['wood', 'stone', 'food', 'water'];
export const JOBS: Job[] = ['wood', 'stone', 'food', 'water', 'build', 'reproduce'];

export const RESOURCE_INFO: Record<ResourceId, { name: string; icon: string }> = {
  wood: { name: 'Madera', icon: '🪵' },
  stone: { name: 'Piedra', icon: '🪨' },
  food: { name: 'Comida', icon: '🍎' },
  water: { name: 'Agua', icon: '💧' },
};

export const JOB_INFO: Record<Job, { name: string; icon: string }> = {
  wood: { name: 'Talar madera', icon: '🪓' },
  stone: { name: 'Extraer piedra', icon: '⛏️' },
  food: { name: 'Producir comida', icon: '🌾' },
  water: { name: 'Recolectar agua', icon: '💧' },
  build: { name: 'Construir', icon: '🔨' },
  reproduce: { name: 'Reproducción', icon: '❤️' },
};

export const START_STOCK: Record<ResourceId, number> = { wood: 60, stone: 30, food: 50, water: 50 };
export const BASE_STORAGE = 300;
export const DEPOT_STORAGE = 200;

/** Segundos de trabajo para producir una unidad. */
export const WORK_SECONDS = { wood: 8, stone: 10, forage: 9, farm: 6, water: 7 };

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
export const NODE_AMOUNT = { tree: 20, rock: 40, bush: 15 };
export const NODE_SLOTS = { tree: 1, rock: 2, bush: 1, water: 3 };

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

export const SCORE = { citizen: 2, building: 5, base: 10 };
