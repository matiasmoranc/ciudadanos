import {
  BASE_HOUSING,
  BASE_STORAGE,
  BASES_PER_PLAYER,
  BIRTH_COST,
  BUILDINGS,
  CONSUMPTION_PER_MIN,
  DEPOT_STORAGE,
  DEPOT_UPGRADE_STORAGE,
  DRAFT_SECONDS,
  EXPEDITION_COST,
  EXPEDITION_SETTLERS,
  FARM_UPGRADE_SECONDS,
  FARM_WATER,
  HOUSE_CAPACITY,
  HOUSE_UPGRADE_CAPACITY,
  JOBS,
  MAX_POPULATION,
  MIN_BASE_DISTANCE,
  START_BASE_DISTANCE,
  REPRODUCTION_SECONDS,
  RESOURCES,
  RESOURCE_INFO,
  SCORE,
  SHORTAGE_DEATH_SECONDS,
  SHORTAGE_GRACE_SECONDS,
  SHORTAGE_PRODUCTIVITY,
  SHORTAGE_WARNING_SECONDS,
  SOIL_TIRED,
  SPECIALTY_BONUS,
  START_CITIZENS,
  START_STOCK,
  SURVIVAL_LOW,
  SURVIVAL_OK,
  SURVIVAL_SHARE,
  TICKS_PER_SECOND,
  TOTAL_ROUNDS,
  TRADE_SECONDS,
  TURN_SECONDS,
  UPGRADES,
  WALK_SPEED,
  WELL_UPGRADE_SLOTS,
  WORKSITE_SLOTS,
  WORK_RANGE,
  WORK_SECONDS,
  seconds,
} from './config';
import { createEco, farmsOf, noteExtraction, noteTurn, stepEcology, yieldFactor } from './ecology';
import { generateMap, isLand, segmentClear } from './mapgen';
import { findPath } from './path';
import { stepRng } from './rng';
import { counter, market, propose, respond } from './trade';
import { etaOf, freeWallSlot, orderArmy, retreatArmy, sendArmy, setStance, soldiersOf, stepWar, train, troopCount, wallPoint } from './war';
import type {
  Base,
  Building,
  BuildingType,
  Citizen,
  Command,
  CommandResult,
  Expedition,
  GameEvent,
  GameState,
  Job,
  Player,
  Point,
  ResourceId,
  ResourceNode,
  Site,
  Stock,
  Target,
  ToastLevel,
} from './types';

export interface PlayerSetup {
  name: string;
  color: number;
  isBot: boolean;
}

export const emptyJobs = (): Record<Job, number> => ({
  wood: 0,
  stone: 0,
  iron: 0,
  gold: 0,
  food: 0,
  water: 0,
  build: 0,
  reproduce: 0,
});

export function random(s: GameState): number {
  const [next, value] = stepRng(s.rng);
  s.rng = next;
  return value;
}

export function createGame(seed: number, setups: PlayerSetup[]): GameState {
  const map = generateMap(seed);
  const order = setups.flatMap((_, i) => i);
  const draft = Array.from({ length: BASES_PER_PLAYER }, (_, round) =>
    round % 2 === 0 ? order : [...order].reverse(),
  ).flat();
  const s: GameState = {
    tick: 0,
    rng: seed ^ 0x5bd1e995,
    round: 0,
    phase: { kind: 'draft', order: draft, index: 0, endsAt: seconds(DRAFT_SECONDS), botActAt: seconds(1.5) },
    map,
    nodes: map.nodes.map((n) => ({ ...n })),
    eco: [],
    players: setups.map((p, id) => ({
      ...p,
      id,
      stock: { ...START_STOCK },
      shortage: { food: 0, water: 0 },
      alive: true,
    })),
    bases: [],
    citizens: [],
    buildings: [],
    expeditions: [],
    armies: [],
    shots: [],
    offers: [],
    events: [],
    warned: {},
    nextId: 1,
  };
  s.eco = createEco(s);
  return s;
}

export function say(s: GameState, player: number | null, text: string, level: ToastLevel = 'info') {
  const event: GameEvent = { player, text, level };
  s.events.push(event);
  if (s.events.length > 60) s.events.shift();
}

/** Avisa como mucho una vez por período, para no llenar la pantalla. */
export function warn(s: GameState, key: string, player: number, text: string, level: ToastLevel, cooldown = 45) {
  const last = s.warned[key];
  if (last !== undefined && s.tick - last < seconds(cooldown)) return;
  s.warned[key] = s.tick;
  say(s, player, text, level);
}

// ---- Consultas -------------------------------------------------------------

export const citizensOf = (s: GameState, baseId: number) => s.citizens.filter((c) => c.baseId === baseId);
export const populationOf = (s: GameState, player: number) =>
  s.citizens.filter((c) => c.owner === player).length +
  s.expeditions.reduce((sum, e) => sum + (e.owner === player ? e.settlers : 0), 0) +
  soldiersOf(s, player);
export const basesOf = (s: GameState, player: number) => s.bases.filter((b) => b.owner === player);

export const capacityOf = (s: GameState, base: Base) =>
  s.buildings
    .filter((b) => b.baseId === base.id && b.type === 'house' && b.done)
    .reduce((sum, b) => sum + HOUSE_CAPACITY + (b.level > 1 ? HOUSE_UPGRADE_CAPACITY : 0), BASE_HOUSING);

export const storageOf = (s: GameState, player: number) =>
  s.buildings
    .filter((b) => b.owner === player && b.type === 'depot' && b.done)
    .reduce((sum, b) => sum + DEPOT_STORAGE + (b.level > 1 ? DEPOT_UPGRADE_STORAGE : 0), BASE_STORAGE);

/** Una obra nueva o una mejora en curso: en ambos casos hacen falta constructores. */
export const needsWork = (b: Building) => !b.done || b.upgrading;

const slotsOf = (b: Building) => WORKSITE_SLOTS + (b.type === 'well' && b.level > 1 ? WELL_UPGRADE_SLOTS : 0);

export const assignedTotal = (base: Base) => JOBS.reduce((sum, job) => sum + base.jobs[job], 0);

export function productivityOf(player: Player): number {
  return player.stock.food <= 0 || player.stock.water <= 0 ? SHORTAGE_PRODUCTIVITY : 1;
}

export function scoreOf(s: GameState, player: number) {
  const soldiers = soldiersOf(s, player);
  const citizens = populationOf(s, player) - soldiers;
  const buildings = s.buildings.filter((b) => b.owner === player && b.done).length;
  const bases = basesOf(s, player).length;
  const upgrades = s.buildings.filter((b) => b.owner === player && b.level > 1).length;
  return {
    citizens,
    soldiers,
    buildings,
    bases,
    upgrades,
    total:
      citizens * SCORE.citizen +
      soldiers * SCORE.soldier +
      buildings * SCORE.building +
      bases * SCORE.base +
      upgrades * SCORE.upgrade,
  };
}

export function siteAvailability(s: GameState, site: Site): string | null {
  const claimed = [...s.bases.map((b) => b.siteId), ...s.expeditions.map((e) => e.siteId)];
  if (claimed.includes(site.id)) return 'Este lugar ya está ocupado.';
  const distance = s.phase.kind === 'draft' ? START_BASE_DISTANCE : MIN_BASE_DISTANCE;
  const tooClose = (other: Site) =>
    claimed.some((id) => {
      const taken = s.map.sites[id];
      return Math.hypot(taken.x - other.x, taken.y - other.y) < distance;
    });
  if (!tooClose(site)) return null;
  // En la selección inicial nadie puede quedarse sin lugar: ahí la distancia cede.
  const anyFar = s.map.sites.some((other) => !claimed.includes(other.id) && !tooClose(other));
  return s.phase.kind !== 'draft' || anyFar ? 'Está demasiado cerca de otra base.' : null;
}

function nodesInReach(s: GameState, base: Base): ResourceNode[] {
  return s.map.sites[base.siteId].nodeIds.map((id) => s.nodes[id]);
}

const JOB_NODE: Partial<Record<Job, ResourceNode['kind']>> = {
  wood: 'tree',
  stone: 'rock',
  iron: 'iron',
  gold: 'gold',
  food: 'bush',
  water: 'water',
};
const JOB_SITE: Partial<Record<Job, BuildingType>> = { food: 'farm', water: 'well' };

const hasStock = (node: ResourceNode) => node.amount !== 0 && node.closed === null;

export function hasSource(s: GameState, base: Base, job: Job): boolean {
  if (job === 'build') return s.buildings.some((b) => b.baseId === base.id && needsWork(b));
  if (job === 'reproduce') return true;
  const site = JOB_SITE[job];
  if (site && s.buildings.some((b) => b.baseId === base.id && b.type === site && b.done)) return true;
  const kind = JOB_NODE[job];
  return nodesInReach(s, base).some((n) => n.kind === kind && hasStock(n));
}

export interface ResourceRate {
  byBase: { baseId: number; name: string; rate: number }[];
  consumption: number;
  /** Agua que usan las granjas al producir. */
  irrigation: number;
  net: number;
}

/** Producción por minuto según quién está trabajando ahora. */
export function ratesFor(s: GameState, player: number): Record<ResourceId, ResourceRate> {
  const owner = s.players[player];
  const productivity = productivityOf(owner);
  const population = populationOf(s, player);
  const result = {} as Record<ResourceId, ResourceRate>;
  const irrigation = s.citizens
    .filter((c) => c.owner === player && c.job === 'food' && c.target?.kind === 'building')
    .reduce((sum, c) => sum + (60 / secondsPerUnit(s, c, s.bases.find((b) => b.id === c.baseId)!)) * productivity * FARM_WATER, 0);
  for (const resource of RESOURCES) {
    const vital = resource === 'food' || resource === 'water';
    const consumption = vital ? population * CONSUMPTION_PER_MIN : 0;
    const byBase = basesOf(s, player).map((base) => {
      let rate = 0;
      for (const c of s.citizens) {
        if (c.baseId !== base.id || c.job !== resource || !c.target) continue;
        rate += (60 / secondsPerUnit(s, c, base)) * productivity;
      }
      return { baseId: base.id, name: base.name, rate };
    });
    const produced = byBase.reduce((sum, b) => sum + b.rate, 0);
    const irrigated = resource === 'water' ? irrigation : 0;
    result[resource] = { byBase, consumption, irrigation: irrigated, net: produced - consumption - irrigated };
  }
  return result;
}

export const regionBonus = (s: GameState, base: Base, job: Job) =>
  s.map.sites[base.siteId].specialty.includes(job) ? SPECIALTY_BONUS : 1;

function secondsPerUnit(s: GameState, c: Citizen, base: Base): number {
  if (c.job === 'idle' || c.job === 'build' || c.job === 'reproduce') return 1;
  let time: number;
  let farm: Building | undefined;
  if (c.job === 'food') {
    const target = c.target;
    farm = target?.kind === 'building' ? s.buildings.find((b) => b.id === target.id) : undefined;
    time = !farm ? WORK_SECONDS.forage : farm.level > 1 ? FARM_UPGRADE_SECONDS : WORK_SECONDS.farm;
  } else {
    time = WORK_SECONDS[c.job];
  }
  return time / regionBonus(s, base, c.job) / yieldFactor(s, base, c.job, farm);
}

// ---- Comandos --------------------------------------------------------------

export function activePlayer(s: GameState): number | null {
  if (s.phase.kind === 'draft') return s.phase.order[s.phase.index];
  if (s.phase.kind === 'decisions' || s.phase.kind === 'trade') return s.phase.player;
  return null;
}

export function issue(s: GameState, player: number, cmd: Command): CommandResult {
  // Responder ofertas es lo único que se puede hacer fuera del turno propio.
  if (cmd.type === 'respond') return respond(s, player, cmd.offerId, cmd.accept);
  if (cmd.type === 'counter') return counter(s, player, cmd.offerId, cmd.give, cmd.want);
  if (activePlayer(s) !== player) return { ok: false, error: 'No es tu turno.' };
  if (cmd.type === 'pickSite') return pickSite(s, player, cmd.siteId);
  if (s.phase.kind === 'trade') {
    if (cmd.type === 'endTurn') {
      finishTrade(s);
      return { ok: true };
    }
    if (cmd.type === 'propose') return propose(s, player, cmd.to, cmd.give, cmd.want);
    if (cmd.type === 'market') return market(s, player, cmd.give, cmd.want);
    return { ok: false, error: 'Durante el comercio no se pueden cambiar las órdenes.' };
  }
  if (s.phase.kind !== 'decisions') return { ok: false, error: 'Todavía no empezó la partida.' };
  switch (cmd.type) {
    case 'endTurn':
      startTrade(s, player);
      return { ok: true };
    case 'setJob':
      return setJob(s, player, cmd.baseId, cmd.job, cmd.delta);
    case 'setAutoSurvive': {
      const base = s.bases.find((b) => b.id === cmd.baseId && b.owner === player);
      if (!base) return { ok: false, error: 'Esa base no es tuya.' };
      base.autoSurvive = cmd.value;
      refreshBase(s, base);
      return { ok: true };
    }
    case 'build':
      return orderBuilding(s, player, cmd.baseId, cmd.building);
    case 'upgrade':
      return orderUpgrade(s, player, cmd.baseId, cmd.building);
    case 'foundBase':
      return foundBase(s, player, cmd.baseId, cmd.siteId);
    case 'train':
      return train(s, player, cmd.baseId, cmd.kind);
    case 'setStance':
      return setStance(s, player, cmd.baseId, cmd.stance);
    case 'sendArmy':
      return sendArmy(s, player, cmd.baseId, cmd.common, cmd.heavy, cmd.order);
    case 'orderArmy':
      return orderArmy(s, player, cmd.armyId, cmd.order);
    case 'retreat':
      return retreatArmy(s, player, cmd.armyId);
    default:
      return { ok: false, error: 'Eso se hace en la fase de comercio.' };
  }
}

function pickSite(s: GameState, player: number, siteId: number): CommandResult {
  if (s.phase.kind !== 'draft') return { ok: false, error: 'La selección ya terminó.' };
  const site = s.map.sites[siteId];
  if (!site) return { ok: false, error: 'Ese lugar no existe.' };
  const problem = siteAvailability(s, site);
  if (problem) return { ok: false, error: problem };

  createBase(s, player, site, START_CITIZENS);

  s.phase.index++;
  if (s.phase.index >= s.phase.order.length) {
    s.round = 1;
    startTurn(s, 0);
  } else {
    s.phase.endsAt = s.tick + seconds(DRAFT_SECONDS);
    s.phase.botActAt = s.tick + seconds(1.5);
  }
  return { ok: true };
}

function createBase(s: GameState, player: number, site: Site, citizens: number): Base {
  const base: Base = {
    id: s.nextId++,
    owner: player,
    siteId: site.id,
    name: site.name,
    x: site.x,
    y: site.y,
    jobs: emptyJobs(),
    effective: emptyJobs(),
    autoSurvive: true,
    crisis: { food: false, water: false },
    reproProgress: 0,
    garrison: { common: 0, heavy: 0 },
    wounds: 0,
    training: [],
    stance: 'balanced',
  };
  s.bases.push(base);
  for (let i = 0; i < citizens; i++) addCitizen(s, base);
  return base;
}

function setJob(s: GameState, player: number, baseId: number, job: Job, delta: number): CommandResult {
  const base = s.bases.find((b) => b.id === baseId && b.owner === player);
  if (!base) return { ok: false, error: 'Esa base no es tuya.' };
  const next = base.jobs[job] + delta;
  if (next < 0) return { ok: false, error: 'No hay trabajadores para quitar.' };
  if (assignedTotal(base) + delta > citizensOf(s, baseId).length) {
    return { ok: false, error: 'Primero liberá un ciudadano de otra tarea.' };
  }
  base.jobs[job] = next;
  refreshBase(s, base);
  return { ok: true };
}

export function missingFor(player: Player, type: BuildingType) {
  return missingCost(player, BUILDINGS[type].cost);
}

export function missingCost(player: Player, cost: Stock): { resource: ResourceId; amount: number }[] {
  return RESOURCES.flatMap((resource) => {
    const need = cost[resource] ?? 0;
    const have = Math.floor(player.stock[resource]);
    return have < need ? [{ resource, amount: need - have }] : [];
  });
}

function orderBuilding(s: GameState, player: number, baseId: number, type: BuildingType): CommandResult {
  const base = s.bases.find((b) => b.id === baseId && b.owner === player);
  if (!base) return { ok: false, error: 'Esa base no es tuya.' };
  const owner = s.players[player];
  const lacking = lackingError(missingFor(owner, type));
  if (lacking) return lacking;
  const wall = type === 'wallWood' || type === 'wallStone';
  const slot = wall ? freeWallSlot(s, base) : null;
  if (wall && slot === null) return { ok: false, error: 'El anillo de muros ya está completo.' };
  const spot = slot !== null ? wallPoint(base, slot) : findBuildSpot(s, base, type);
  if (!spot) return { ok: false, error: 'No queda espacio para construir en esta base.' };
  const info = BUILDINGS[type];
  pay(owner, info.cost);
  s.buildings.push({
    id: s.nextId++,
    type,
    baseId,
    owner: player,
    x: spot.x,
    y: spot.y,
    progress: 0,
    required: seconds(info.seconds),
    done: false,
    level: 1,
    upgrading: false,
    users: 0,
    slot,
    hp: 0,
    soil: 1,
  });
  if (base.jobs.build === 0) {
    warn(s, `nobuilder:${base.id}`, player, `Asigná un constructor en ${base.name} para empezar la obra.`, 'warn', 20);
  }
  return { ok: true };
}

function lackingError(missing: { resource: ResourceId; amount: number }[]): CommandResult | null {
  if (missing.length === 0) return null;
  const first = missing[0];
  return { ok: false, error: `Faltan ${first.amount} de ${RESOURCE_INFO[first.resource].name.toLowerCase()}.` };
}

function pay(player: Player, cost: Stock) {
  for (const resource of RESOURCES) player.stock[resource] -= cost[resource] ?? 0;
}

export const upgradable = (s: GameState, base: Base, type: BuildingType) =>
  s.buildings.filter((b) => b.baseId === base.id && b.type === type && b.done && b.level === 1 && !b.upgrading);

function orderUpgrade(s: GameState, player: number, baseId: number, type: BuildingType): CommandResult {
  const base = s.bases.find((b) => b.id === baseId && b.owner === player);
  if (!base) return { ok: false, error: 'Esa base no es tuya.' };
  const building = upgradable(s, base, type)[0];
  if (!building) return { ok: false, error: 'No hay edificios para mejorar.' };
  const owner = s.players[player];
  const info = UPGRADES[type];
  if (!info) return { ok: false, error: 'Ese edificio no tiene mejoras.' };
  const lacking = lackingError(missingCost(owner, info.cost));
  if (lacking) return lacking;
  pay(owner, info.cost);
  building.upgrading = true;
  building.progress = 0;
  building.required = seconds(info.seconds);
  if (base.jobs.build === 0) {
    warn(s, `nobuilder:${base.id}`, player, `Asigná un constructor en ${base.name} para empezar la mejora.`, 'warn', 20);
  }
  return { ok: true };
}

function foundBase(s: GameState, player: number, baseId: number, siteId: number): CommandResult {
  const origin = s.bases.find((b) => b.id === baseId && b.owner === player);
  if (!origin) return { ok: false, error: 'Esa base no es tuya.' };
  const site = s.map.sites[siteId];
  if (!site) return { ok: false, error: 'Ese lugar no existe.' };
  const problem = siteAvailability(s, site);
  if (problem) return { ok: false, error: problem };
  const owner = s.players[player];
  const lacking = lackingError(missingCost(owner, EXPEDITION_COST));
  if (lacking) return lacking;
  const people = citizensOf(s, origin.id);
  if (people.length <= EXPEDITION_SETTLERS) {
    return { ok: false, error: `Hacen falta más de ${EXPEDITION_SETTLERS} ciudadanos en la base de origen.` };
  }
  const path = findPath(s.map, origin, site);
  if (!path) return { ok: false, error: 'No hay camino por tierra hasta ese lugar.' };

  pay(owner, EXPEDITION_COST);
  const settlers = [...people]
    .sort((a, b) => Number(b.job === 'idle') - Number(a.job === 'idle'))
    .slice(0, EXPEDITION_SETTLERS);
  s.citizens = s.citizens.filter((c) => !settlers.includes(c));
  s.expeditions.push({
    id: s.nextId++,
    owner: player,
    siteId,
    settlers: EXPEDITION_SETTLERS,
    path,
    leg: 1,
    x: origin.x,
    y: origin.y,
  });
  refreshBase(s, origin);
  return { ok: true };
}

/** Busca lugar en espiral alrededor de la base para que el pueblo crezca ordenado. */
function findBuildSpot(s: GameState, base: Base, type: BuildingType): Point | null {
  const footprint = BUILDINGS[type].footprint;
  const reach = nodesInReach(s, base).filter((n) => n.kind !== 'water' && hasStock(n));
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < 160; i++) {
    const radius = 34 + i * 0.4;
    const angle = i * golden;
    const p = { x: base.x + Math.cos(angle) * radius, y: base.y + Math.sin(angle) * radius };
    if (!isLand(s.map, p.x, p.y) || !segmentClear(s.map, base, p)) continue;
    if (reach.some((n) => Math.hypot(n.x - p.x, n.y - p.y) < footprint * 0.55)) continue;
    const blocked = s.buildings.some(
      (b) => Math.hypot(b.x - p.x, b.y - p.y) < (BUILDINGS[b.type].footprint + footprint) * 0.55,
    );
    if (!blocked) return p;
  }
  return null;
}

// ---- Turnos ----------------------------------------------------------------

function startTurn(s: GameState, player: number) {
  noteTurn(s, player);
  const offset = 4 + random(s) * 4;
  s.phase = {
    kind: 'decisions',
    player,
    endsAt: s.tick + seconds(TURN_SECONDS),
    botActAt: s.tick + seconds(offset),
  };
}

function startTrade(s: GameState, player: number) {
  s.phase = {
    kind: 'trade',
    player,
    endsAt: s.tick + seconds(TRADE_SECONDS),
    botActAt: s.tick + seconds(1 + random(s) * 2),
    acted: false,
  };
}

function finishTrade(s: GameState) {
  s.offers = [];
  nextTurn(s);
}

function nextTurn(s: GameState) {
  if (s.phase.kind !== 'decisions' && s.phase.kind !== 'trade') return;
  const from = s.phase.player;
  const count = s.players.length;
  for (let step = 1; step <= count; step++) {
    if (from + step === count && ++s.round > TOTAL_ROUNDS) {
      finishByScore(s);
      return;
    }
    const player = (from + step) % count;
    if (s.players[player].alive) {
      startTurn(s, player);
      return;
    }
  }
}

function finishByScore(s: GameState) {
  s.round = TOTAL_ROUNDS;
  const ranked = s.players
    .filter((p) => p.alive)
    .sort((a, b) => scoreOf(s, b.id).total - scoreOf(s, a.id).total);
  const winner = ranked[0]?.id ?? null;
  s.phase = {
    kind: 'over',
    winner,
    reason: winner === null ? 'No sobrevivió nadie.' : `${s.players[winner].name} gana por puntos.`,
  };
}

function checkEliminations(s: GameState) {
  for (const player of s.players) {
    if (!player.alive || populationOf(s, player.id) > 0) continue;
    player.alive = false;
    say(s, null, `${player.name} se quedó sin ciudadanos.`, 'bad');
    if (activePlayer(s) === player.id) finishTrade(s);
  }
  if (s.phase.kind === 'over') return;
  const human = s.players.find((p) => !p.isBot);
  const alive = s.players.filter((p) => p.alive);
  if (human && !human.alive) {
    s.phase = { kind: 'over', winner: null, reason: 'Tu civilización desapareció.' };
  } else if (alive.length === 1 && s.players.length > 1) {
    s.phase = { kind: 'over', winner: alive[0].id, reason: `${alive[0].name} es la última civilización en pie.` };
  } else if (alive.length === 0) {
    s.phase = { kind: 'over', winner: null, reason: 'No sobrevivió nadie.' };
  }
}

// ---- Simulación ------------------------------------------------------------

export function tick(s: GameState) {
  if (s.phase.kind === 'over') return;
  s.tick++;

  if (s.phase.kind === 'draft') {
    if (s.tick >= s.phase.endsAt) autoPick(s);
    return;
  }

  if (s.tick >= s.phase.endsAt) {
    if (s.phase.kind === 'decisions') startTrade(s, s.phase.player);
    else finishTrade(s);
  }
  if ((s.phase.kind as string) === 'over') return;

  if (s.tick % TICKS_PER_SECOND === 0) {
    for (const base of s.bases) refreshBase(s, base);
  }

  for (const node of s.nodes) node.users = 0;
  for (const building of s.buildings) building.users = 0;
  for (const c of s.citizens) {
    if (c.target?.kind === 'node') s.nodes[c.target.id].users++;
    else if (c.target?.kind === 'building') {
      const building = s.buildings.find((b) => b.id === c.target!.id);
      if (building) building.users++;
    }
  }

  for (const c of s.citizens) stepCitizen(s, c);
  for (const expedition of [...s.expeditions]) stepExpedition(s, expedition);
  stepWar(s);
  stepEcology(s);
  for (const base of s.bases) stepReproduction(s, base);
  for (const player of s.players) if (player.alive) stepSurvival(s, player);
  if (s.tick % TICKS_PER_SECOND === 0) checkEliminations(s);
}

export function autoPick(s: GameState) {
  if (s.phase.kind !== 'draft') return;
  const player = s.phase.order[s.phase.index];
  const best = bestSite(s);
  if (best) issue(s, player, { type: 'pickSite', siteId: best.id });
}

export function bestSite(s: GameState): Site | null {
  const open = s.map.sites.filter((site) => siteAvailability(s, site) === null);
  const value = (site: Site) => {
    const { wood, stone, food, water, iron } = site.stars;
    return wood + stone + food + water + Math.min(water, 2) * 2 + Math.min(food, 3) + Math.min(iron, 3) * 0.5;
  };
  return open.sort((a, b) => value(b) - value(a))[0] ?? null;
}

function addCitizen(s: GameState, base: Base): Citizen {
  const angle = random(s) * Math.PI * 2;
  const citizen: Citizen = {
    id: s.nextId++,
    baseId: base.id,
    owner: base.owner,
    x: base.x + Math.cos(angle) * 12,
    y: base.y + Math.sin(angle) * 12,
    job: 'idle',
    state: 'idle',
    target: null,
    dest: null,
    via: null,
    progress: 0,
    wait: 0,
  };
  s.citizens.push(citizen);
  return citizen;
}

function release(c: Citizen) {
  c.target = null;
  c.dest = null;
  c.via = null;
  c.state = 'idle';
  c.progress = 0;
  c.wait = 0;
}

/** Recalcula trabajos efectivos y reparte ciudadanos. */
export function refreshBase(s: GameState, base: Base) {
  const people = citizensOf(s, base.id);
  const population = people.length;

  // Una muerte puede dejar más trabajos pedidos que ciudadanos.
  let excess = assignedTotal(base) - population;
  for (const job of [...JOBS].reverse()) {
    if (excess <= 0) break;
    const cut = Math.min(excess, base.jobs[job]);
    base.jobs[job] -= cut;
    excess -= cut;
  }

  const owner = s.players[base.owner];
  const effective = { ...base.jobs };
  for (const resource of ['food', 'water'] as const) {
    const stock = owner.stock[resource];
    if (!base.autoSurvive) base.crisis[resource] = false;
    else if (stock < SURVIVAL_LOW) base.crisis[resource] = true;
    else if (stock > SURVIVAL_OK) base.crisis[resource] = false;
    if (!base.crisis[resource] || !hasSource(s, base, resource)) continue;
    let take = Math.max(1, Math.ceil(population * SURVIVAL_SHARE));
    const donors: Job[] = ['wood', 'stone', 'reproduce', 'build', resource === 'food' ? 'water' : 'food'];
    for (const donor of donors) {
      if (donor === resource) continue;
      if ((donor === 'food' || donor === 'water') && base.crisis[donor]) continue;
      const moved = Math.min(take, effective[donor]);
      effective[donor] -= moved;
      effective[resource] += moved;
      take -= moved;
    }
  }
  base.effective = effective;

  const counts: Record<string, number> = {};
  for (const c of people) {
    const want = c.job === 'idle' ? 0 : effective[c.job];
    const have = counts[c.job] ?? 0;
    if (c.job !== 'idle' && have >= want) {
      c.job = 'idle';
      release(c);
    } else {
      counts[c.job] = have + 1;
    }
  }
  for (const job of JOBS) {
    let vacancies = effective[job] - (counts[job] ?? 0);
    for (const c of people) {
      if (vacancies <= 0) break;
      if (c.job === 'idle') {
        c.job = job;
        release(c);
        vacancies--;
      }
    }
  }
}

function findTarget(s: GameState, c: Citizen, base: Base): (Target & Point) | null {
  const nearest = <T extends Point>(items: T[]) => {
    let best: T | null = null;
    let distance = Infinity;
    for (const item of items) {
      const d = (item.x - c.x) ** 2 + (item.y - c.y) ** 2;
      if (d < distance) {
        distance = d;
        best = item;
      }
    }
    return best;
  };

  if (c.job === 'build') {
    const site = nearest(s.buildings.filter((b) => b.baseId === base.id && needsWork(b)));
    return site ? { kind: 'building', id: site.id, x: site.x, y: site.y } : null;
  }
  const type = c.job === 'idle' ? undefined : JOB_SITE[c.job];
  if (type) {
    const site = nearest(
      s.buildings.filter((b) => b.baseId === base.id && b.type === type && b.done && b.users < slotsOf(b)),
    );
    // La granja rinde más que recolectar: siempre va primero.
    if (site && type === 'farm') {
      site.users++;
      return { kind: 'building', id: site.id, x: site.x, y: site.y };
    }
    const kind = JOB_NODE[c.job as Job];
    const node = nearest(nodesInReach(s, base).filter((n) => n.kind === kind && hasStock(n) && n.users < n.slots));
    const nodeDistance = node ? Math.hypot(node.x - c.x, node.y - c.y) : Infinity;
    const siteDistance = site ? Math.hypot(site.x - c.x, site.y - c.y) : Infinity;
    if (site && siteDistance <= nodeDistance) {
      site.users++;
      return { kind: 'building', id: site.id, x: site.x, y: site.y };
    }
    if (node) {
      node.users++;
      return { kind: 'node', id: node.id, x: node.x, y: node.y };
    }
    return null;
  }
  const kind = JOB_NODE[c.job as Job];
  const node = nearest(nodesInReach(s, base).filter((n) => n.kind === kind && hasStock(n) && n.users < n.slots));
  if (!node) return null;
  node.users++;
  return { kind: 'node', id: node.id, x: node.x, y: node.y };
}

function walkTo(s: GameState, c: Citizen, base: Base, point: Point) {
  c.dest = point;
  c.state = 'walk';
  c.via = segmentClear(s.map, c, point) ? null : { x: base.x, y: base.y };
}

/** Avanza hacia el destino. Devuelve true al llegar. */
function advance(c: Citizen): boolean {
  const goal = c.via ?? c.dest;
  if (!goal) return true;
  const step = WALK_SPEED / TICKS_PER_SECOND;
  const dx = goal.x - c.x;
  const dy = goal.y - c.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= step) {
    c.x = goal.x;
    c.y = goal.y;
    if (c.via) {
      c.via = null;
      return false;
    }
    return true;
  }
  c.x += (dx / distance) * step;
  c.y += (dy / distance) * step;
  return false;
}

function targetAlive(s: GameState, c: Citizen): boolean {
  const target = c.target;
  if (!target) return false;
  if (target.kind === 'node') return hasStock(s.nodes[target.id]);
  const building = s.buildings.find((b) => b.id === target.id);
  if (!building) return false;
  return c.job === 'build' ? needsWork(building) : building.done;
}

export function gain(s: GameState, player: Player, resource: ResourceId, amount: number) {
  const cap = storageOf(s, player.id);
  const before = player.stock[resource];
  player.stock[resource] = Math.min(cap, before + amount);
  if (before < cap && player.stock[resource] >= cap) {
    warn(s, `full:${player.id}:${resource}`, player.id, `${RESOURCE_INFO[resource].name}: depósitos llenos. Construí un Depósito.`, 'warn', 90);
  }
}

function stepCitizen(s: GameState, c: Citizen) {
  const base = s.bases.find((b) => b.id === c.baseId)!;
  const player = s.players[c.owner];

  if (c.job === 'idle' || c.job === 'reproduce') {
    if (c.state === 'walk') {
      if (advance(c)) release(c);
      return;
    }
    if (c.wait > 0) {
      c.wait--;
      return;
    }
    const spread = c.job === 'reproduce' ? 18 : 42;
    const angle = random(s) * Math.PI * 2;
    const p = { x: base.x + Math.cos(angle) * spread, y: base.y + Math.sin(angle) * spread };
    c.wait = seconds(2 + random(s) * 4);
    if (isLand(s.map, p.x, p.y) && segmentClear(s.map, c, p)) walkTo(s, c, base, p);
    return;
  }

  if (c.target && !targetAlive(s, c)) release(c);

  if (!c.target) {
    if ((s.tick + c.id) % 10 !== 0) return;
    const found = findTarget(s, c, base);
    if (!found) {
      reportNoSource(s, base, c.job);
      return;
    }
    c.target = found.kind === 'node' ? { kind: 'node', id: found.id } : { kind: 'building', id: found.id };
    const angle = (c.id * 2.39996) % (Math.PI * 2);
    walkTo(s, c, base, {
      x: found.x + Math.cos(angle) * WORK_RANGE,
      y: found.y + Math.sin(angle) * WORK_RANGE,
    });
    return;
  }

  if (c.state === 'walk') {
    if (advance(c)) {
      c.state = 'work';
      c.dest = null;
      c.progress = 0;
    }
    return;
  }

  const productivity = productivityOf(player);
  if (c.job === 'build') {
    const building = s.buildings.find((b) => b.id === c.target!.id)!;
    building.progress += productivity * regionBonus(s, base, 'build');
    if (building.progress < building.required) return;
    if (building.upgrading) {
      building.upgrading = false;
      building.level = 2;
      say(s, player.id, `${UPGRADES[building.type]?.name} lista en ${base.name}.`, 'good');
    } else {
      building.done = true;
      building.hp = BUILDINGS[building.type].hp ?? 0;
      if (building.slot === null) say(s, player.id, `${BUILDINGS[building.type].name} terminada en ${base.name}.`, 'good');
    }
    return;
  }

  c.progress += productivity;
  if (c.progress < seconds(secondsPerUnit(s, c, base))) return;
  c.progress = 0;
  const resource = c.job;
  if (c.target?.kind === 'node') {
    const node = s.nodes[c.target.id];
    if (node.amount > 0) node.amount--;
  } else if (resource === 'food') {
    player.stock.water = Math.max(0, player.stock.water - FARM_WATER);
  }
  gain(s, player, resource, 1);
  noteExtraction(s, base, resource);
}

function reportNoSource(s: GameState, base: Base, job: Job) {
  const messages: Partial<Record<Job, string>> = {
    wood: `No quedan árboles disponibles cerca de la ${base.name}.`,
    stone: `No quedan rocas disponibles cerca de la ${base.name}.`,
    iron: `No hay hierro cerca de la ${base.name}.`,
    gold: `No hay oro cerca de la ${base.name}.`,
    food: `No queda comida silvestre cerca de la ${base.name}. Construí una granja.`,
    water: `No hay agua cerca de la ${base.name}. Construí un pozo.`,
  };
  const text = messages[job];
  if (text && !hasSource(s, base, job)) warn(s, `nosource:${base.id}:${job}`, base.owner, text, 'warn', 40);
}

function stepExpedition(s: GameState, e: Expedition) {
  let step = WALK_SPEED / TICKS_PER_SECOND;
  while (step > 0 && e.leg < e.path.length) {
    const goal = e.path[e.leg];
    const distance = Math.hypot(goal.x - e.x, goal.y - e.y);
    if (distance > step) {
      e.x += ((goal.x - e.x) / distance) * step;
      e.y += ((goal.y - e.y) / distance) * step;
      return;
    }
    e.x = goal.x;
    e.y = goal.y;
    step -= distance;
    e.leg++;
  }
  s.expeditions.splice(s.expeditions.indexOf(e), 1);
  const site = s.map.sites[e.siteId];
  createBase(s, e.owner, site, e.settlers);
  say(s, e.owner, `La expedición fundó la ${site.name}.`, 'good');
}

export type ReproStatus = 'idle' | 'running' | 'need_two' | 'no_housing' | 'no_supplies' | 'cap';

export function reproductionStatus(s: GameState, base: Base): ReproStatus {
  const player = s.players[base.owner];
  if (base.effective.reproduce === 0) return 'idle';
  if (base.effective.reproduce < 2) return 'need_two';
  if (populationOf(s, base.owner) >= MAX_POPULATION) return 'cap';
  if (citizensOf(s, base.id).length >= capacityOf(s, base)) return 'no_housing';
  const shortage = player.stock.food <= 0 || player.stock.water <= 0;
  if (shortage || player.stock.food < BIRTH_COST.food || player.stock.water < BIRTH_COST.water) return 'no_supplies';
  return 'running';
}

function stepReproduction(s: GameState, base: Base) {
  if (reproductionStatus(s, base) !== 'running') return;
  base.reproProgress += Math.floor(base.effective.reproduce / 2);
  if (base.reproProgress < seconds(REPRODUCTION_SECONDS)) return;
  base.reproProgress = 0;
  const player = s.players[base.owner];
  player.stock.food -= BIRTH_COST.food;
  player.stock.water -= BIRTH_COST.water;
  addCitizen(s, base);
  say(s, base.owner, `Nació un ciudadano en ${base.name}.`, 'good');
}

function stepSurvival(s: GameState, player: Player) {
  const population = populationOf(s, player.id);
  const use = (population * CONSUMPTION_PER_MIN) / 60 / TICKS_PER_SECOND;
  for (const resource of ['food', 'water'] as const) {
    player.stock[resource] = Math.max(0, player.stock[resource] - use);
    if (player.stock[resource] <= 0) player.shortage[resource]++;
    else player.shortage[resource] = 0;
  }

  if (s.tick % seconds(5) === 0) warnAboutShortage(s, player);

  const worst = Math.max(player.shortage.food, player.shortage.water);
  const grace = seconds(SHORTAGE_GRACE_SECONDS);
  if (worst < grace) return;
  if ((worst - grace) % seconds(SHORTAGE_DEATH_SECONDS) !== 0) return;
  killOne(s, player);
}

function warnAboutShortage(s: GameState, player: Player) {
  warnAboutDepletion(s, player);
  const rates = ratesFor(s, player.id);
  for (const resource of ['food', 'water'] as const) {
    const label = RESOURCE_INFO[resource].name.toLowerCase();
    const net = rates[resource].net;
    if (player.stock[resource] <= 0) {
      warn(s, `empty:${player.id}:${resource}`, player.id, `¡Sin ${label}! Tus ciudadanos rinden menos y pueden morir.`, 'bad', 30);
    } else if (net < 0) {
      const left = (player.stock[resource] / -net) * 60;
      if (left <= SHORTAGE_WARNING_SECONDS) {
        const verb = resource === 'food' ? 'Tu comida' : 'Tu agua';
        warn(s, `low:${player.id}:${resource}`, player.id, `${verb} se agotará en ${Math.round(left)} segundos.`, 'warn', 40);
      }
    }
  }
}

const LOW_NODES = 0.15;

/** Parte de lo que había cerca de una base que todavía queda. */
function remainingShare(s: GameState, base: Base, kind: ResourceNode['kind']): number {
  let left = 0;
  let total = 0;
  for (const id of s.map.sites[base.siteId].nodeIds) {
    if (s.nodes[id].kind !== kind) continue;
    left += s.nodes[id].amount;
    total += s.nodes[id].max;
  }
  return total > 0 ? left / total : 1;
}

function warnAboutDepletion(s: GameState, player: Player) {
  for (const alert of alertsFor(s, player.id)) {
    if (alert.key.startsWith('low-')) warn(s, `${alert.key}:${player.id}`, player.id, alert.text, 'warn', 120);
  }
}

export interface Alert {
  key: string;
  text: string;
  level: 'warn' | 'bad';
  armyId?: number;
  /** Lugar al que lleva tocar la alerta. */
  point?: Point;
}

/** Problemas actuales de un jugador, para mostrarlos sin que tenga que buscarlos. */
export function alertsFor(s: GameState, playerId: number): Alert[] {
  const alerts: Alert[] = [];
  const player = s.players[playerId];
  const rates = ratesFor(s, playerId);
  for (const army of s.armies) {
    if (army.owner === playerId || army.order.kind !== 'attack') continue;
    const { baseId } = army.order;
    const target = s.bases.find((b) => b.id === baseId);
    if (target?.owner !== playerId) continue;
    const when = army.sieging ? 'atacando' : `llega en ${etaOf(army)} s`;
    const text = `${s.players[army.owner].name}: ${troopCount(army)} soldados a ${target.name}, ${when}`;
    alerts.push({ key: `army-${army.id}`, text, level: 'bad', armyId: army.id });
  }
  for (const base of basesOf(s, playerId)) {
    const eco = s.eco[base.siteId];
    if (eco.crack) {
      const left = Math.ceil((eco.crackAt - s.tick) / TICKS_PER_SECOND);
      const when = left > 0 ? `derrumbe en ${left} s` : 'derrumbe inminente';
      alerts.push({ key: `crack-${base.id}`, text: `${base.name}: grietas, ${when}`, level: 'bad', point: eco.crack });
    }
    if (eco.drought) alerts.push({ key: `drought-${base.id}`, text: `${base.name}: sequía`, level: 'warn', point: base });
  }
  for (const resource of ['food', 'water'] as const) {
    const name = RESOURCE_INFO[resource].name;
    const net = rates[resource].net;
    if (player.stock[resource] <= 0) {
      alerts.push({ key: `empty-${resource}`, text: `${name}: agotada`, level: 'bad' });
    } else if (net < 0 && (player.stock[resource] / -net) * 60 <= 120) {
      const left = Math.round((player.stock[resource] / -net) * 60);
      alerts.push({ key: `short-${resource}`, text: `${name}: ${left} s`, level: 'warn' });
    }
  }
  for (const base of basesOf(s, playerId)) {
    for (const job of ['wood', 'stone', 'iron', 'gold', 'food'] as const) {
      if (base.effective[job] === 0) continue;
      const share = remainingShare(s, base, JOB_NODE[job]!);
      if (share > 0 && share < LOW_NODES) {
        const name = RESOURCE_INFO[job].name.toLowerCase();
        alerts.push({ key: `low-${job}-${base.id}`, text: `${base.name}: queda poca ${name}`, level: 'warn' });
      }
    }
    if (reproductionStatus(s, base) === 'no_housing') {
      alerts.push({ key: `housing-${base.id}`, text: `${base.name}: sin vivienda`, level: 'warn' });
    }
    if (farmsOf(s, base).some((farm) => farm.soil < SOIL_TIRED)) {
      alerts.push({ key: `soil-${base.id}`, text: `${base.name}: tierra cansada`, level: 'warn', point: base });
    }
    const unbuilt = s.buildings.some((b) => b.baseId === base.id && needsWork(b));
    if (unbuilt && base.effective.build === 0) {
      alerts.push({ key: `builder-${base.id}`, text: `${base.name}: obra sin constructor`, level: 'warn' });
    }
  }
  return alerts;
}

function killOne(s: GameState, player: Player) {
  const bases = basesOf(s, player.id)
    .map((base) => ({ base, people: citizensOf(s, base.id) }))
    .sort((a, b) => b.people.length - a.people.length);
  const largest = bases[0];
  if (!largest || largest.people.length === 0) return;
  const victim = largest.people[Math.floor(random(s) * largest.people.length)];
  s.citizens.splice(s.citizens.indexOf(victim), 1);
  refreshBase(s, largest.base);
  say(s, player.id, `Murió un ciudadano en ${largest.base.name} por la escasez.`, 'bad');
}
