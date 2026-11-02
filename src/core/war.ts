import {
  LOOT_MAX,
  LOOT_PER_SOLDIER,
  LOOT_SHARE,
  RAID_SECONDS,
  CONQUER_SECONDS,
  RESOURCES,
  RING_RADIUS,
  RING_SLOTS,
  SIEGE_RANGE,
  SOLDIERS,
  STANCE_RADIUS,
  TICKS_PER_SECOND,
  TOWER_DAMAGE,
  TOWER_RANGE,
  TRUCE_ROUNDS,
  seconds,
} from './config';
import { citizensOf, emptyJobs, gain, missingCost, random, refreshBase, say } from './game';
import { isLand, isPassable } from './mapgen';
import { findPath } from './path';
import type {
  Army,
  ArmyOrder,
  Base,
  Building,
  CommandResult,
  GameState,
  Point,
  SoldierKind,
  Stance,
  Troops,
} from './types';

const ENGAGE_RANGE = 26;
const WALL_STOP = RING_RADIUS + 14;
const CHASE_REPATH = 30;

export const troopCount = (t: Troops) => t.common + t.heavy;

export const atWar = (s: GameState) => s.round >= TRUCE_ROUNDS;

/** Soldados de un jugador en cualquier lugar: cuentan como población. */
export function soldiersOf(s: GameState, player: number): number {
  let total = 0;
  for (const base of s.bases) {
    if (base.owner === player) total += troopCount(base.garrison) + base.training.length;
  }
  for (const army of s.armies) if (army.owner === player) total += troopCount(army);
  return total;
}

function speedOf(t: Troops) {
  return t.heavy > 0 ? SOLDIERS.heavy.speed : SOLDIERS.common.speed;
}

function attackOf(t: Troops) {
  return t.common * SOLDIERS.common.attack + t.heavy * SOLDIERS.heavy.attack;
}

function defenseOf(t: Troops) {
  const count = troopCount(t);
  if (count === 0) return 0;
  return (t.common * SOLDIERS.common.defense + t.heavy * SOLDIERS.heavy.defense) / count;
}

/** Quita soldados según el daño: caen primero los comunes. Devuelve lo que queda sin aplicar. */
function wound(t: Troops, damage: number, carried: number): number {
  let pending = carried + damage * (10 / (10 + defenseOf(t)));
  while (troopCount(t) > 0) {
    const kind: SoldierKind = t.common > 0 ? 'common' : 'heavy';
    if (pending < SOLDIERS[kind].hp) break;
    pending -= SOLDIERS[kind].hp;
    t[kind]--;
  }
  return pending;
}

// ---- Órdenes ---------------------------------------------------------------

function ownBase(s: GameState, id: number) {
  return s.bases.find((b) => b.id === id);
}

export function destinationOf(s: GameState, order: ArmyOrder): Point | null {
  if (order.kind === 'hold') return order;
  if (order.kind === 'chase') return s.armies.find((a) => a.id === order.armyId) ?? null;
  return ownBase(s, order.baseId) ?? null;
}

function orderProblem(s: GameState, player: number, order: ArmyOrder): string | null {
  const hostile = order.kind === 'attack' || order.kind === 'chase';
  if (hostile && !atWar(s)) return `Hay tregua hasta la ronda ${TRUCE_ROUNDS}.`;
  if (order.kind === 'attack' && ownBase(s, order.baseId)?.owner === player) return 'Esa base ya es tuya.';
  if ((order.kind === 'move' || order.kind === 'retreat') && ownBase(s, order.baseId)?.owner !== player) {
    return 'Esa base no es tuya.';
  }
  if (order.kind === 'chase' && s.armies.find((a) => a.id === order.armyId)?.owner === player) {
    return 'Ese ejército es tuyo.';
  }
  if (order.kind === 'hold' && !isPassable(s.map, order.x, order.y)) return 'No se puede llegar a ese lugar.';
  return destinationOf(s, order) ? null : 'Ese destino ya no existe.';
}

export function train(s: GameState, player: number, baseId: number, kind: SoldierKind): CommandResult {
  const base = ownBase(s, baseId);
  if (!base || base.owner !== player) return { ok: false, error: 'Esa base no es tuya.' };
  if (!s.buildings.some((b) => b.baseId === baseId && b.type === 'barracks' && b.done)) {
    return { ok: false, error: 'Esta base necesita un cuartel.' };
  }
  const owner = s.players[player];
  const missing = missingCost(owner, SOLDIERS[kind].cost);
  if (missing.length > 0) return { ok: false, error: 'No alcanzan los recursos.' };
  const people = citizensOf(s, baseId).sort((a, b) => Number(b.job === 'idle') - Number(a.job === 'idle'));
  if (people.length <= 1) return { ok: false, error: 'No hay ciudadanos para entrenar.' };
  for (const resource of RESOURCES) owner.stock[resource] -= SOLDIERS[kind].cost[resource] ?? 0;
  s.citizens.splice(s.citizens.indexOf(people[0]), 1);
  base.training.push({ kind, left: seconds(SOLDIERS[kind].seconds) });
  refreshBase(s, base);
  return { ok: true };
}

export function setStance(s: GameState, player: number, baseId: number, stance: Stance): CommandResult {
  const base = ownBase(s, baseId);
  if (!base || base.owner !== player) return { ok: false, error: 'Esa base no es tuya.' };
  base.stance = stance;
  return { ok: true };
}

function routeTo(s: GameState, from: Point, order: ArmyOrder): Point[] | null {
  const goal = destinationOf(s, order);
  return goal ? findPath(s.map, from, goal) : null;
}

function announceAttack(s: GameState, army: Army) {
  if (army.order.kind !== 'attack') return;
  const target = ownBase(s, army.order.baseId);
  if (!target) return;
  const name = s.players[army.owner].name;
  say(s, target.owner, `¡${name} envió ${troopCount(army)} soldados hacia ${target.name}!`, 'bad');
}

export function sendArmy(
  s: GameState,
  player: number,
  baseId: number,
  common: number,
  heavy: number,
  order: ArmyOrder,
): CommandResult {
  const base = ownBase(s, baseId);
  if (!base || base.owner !== player) return { ok: false, error: 'Esa base no es tuya.' };
  if (common < 0 || heavy < 0 || common + heavy === 0) return { ok: false, error: 'Elegí cuántos soldados enviar.' };
  if (common > base.garrison.common || heavy > base.garrison.heavy) {
    return { ok: false, error: 'No hay tantos soldados en esta base.' };
  }
  const problem = orderProblem(s, player, order);
  if (problem) return { ok: false, error: problem };
  const path = routeTo(s, base, order);
  if (!path) return { ok: false, error: 'No hay camino hasta ese lugar.' };
  base.garrison.common -= common;
  base.garrison.heavy -= heavy;
  const army: Army = {
    id: s.nextId++,
    owner: player,
    x: base.x,
    y: base.y,
    common,
    heavy,
    wounds: 0,
    order,
    path,
    leg: 1,
    fighting: false,
    sieging: false,
    progress: 0,
    home: null,
  };
  s.armies.push(army);
  announceAttack(s, army);
  return { ok: true };
}

function nearestOwnBase(s: GameState, army: Army): Base | null {
  let best: Base | null = null;
  let distance = Infinity;
  for (const base of s.bases) {
    if (base.owner !== army.owner) continue;
    const d = Math.hypot(base.x - army.x, base.y - army.y);
    if (d < distance) {
      distance = d;
      best = base;
    }
  }
  return best;
}

function assign(s: GameState, army: Army, order: ArmyOrder): boolean {
  const path = routeTo(s, army, order);
  if (!path) return false;
  army.order = order;
  army.path = path;
  army.leg = 1;
  army.sieging = false;
  army.progress = 0;
  return true;
}

export function orderArmy(s: GameState, player: number, armyId: number, order: ArmyOrder): CommandResult {
  const army = s.armies.find((a) => a.id === armyId);
  if (!army || army.owner !== player) return { ok: false, error: 'Ese ejército no es tuyo.' };
  const problem = orderProblem(s, player, order);
  if (problem) return { ok: false, error: problem };
  if (!assign(s, army, order)) return { ok: false, error: 'No hay camino hasta ese lugar.' };
  army.home = null;
  announceAttack(s, army);
  return { ok: true };
}

export function retreatArmy(s: GameState, player: number, armyId: number): CommandResult {
  const army = s.armies.find((a) => a.id === armyId);
  if (!army || army.owner !== player) return { ok: false, error: 'Ese ejército no es tuyo.' };
  const home = nearestOwnBase(s, army);
  if (!home) return { ok: false, error: 'No te queda ninguna base.' };
  assign(s, army, { kind: 'retreat', baseId: home.id });
  return { ok: true };
}

/** Segundos para llegar al final de la ruta actual. */
export function etaOf(army: Army): number {
  let distance = 0;
  let from: Point = army;
  for (let i = army.leg; i < army.path.length; i++) {
    distance += Math.hypot(army.path[i].x - from.x, army.path[i].y - from.y);
    from = army.path[i];
  }
  return Math.ceil(distance / speedOf(army));
}

/** Segundos que tardaría una tropa en llegar a un punto, para decidir antes de enviarla. */
export function estimateEta(s: GameState, from: Point, to: Point, troops: Troops): number | null {
  const path = findPath(s.map, from, to);
  if (!path) return null;
  let distance = 0;
  for (let i = 1; i < path.length; i++) distance += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  return Math.ceil(distance / speedOf(troops));
}

// ---- Muros -----------------------------------------------------------------

/** Tramos que hacen falta para cerrar la base; donde hay agua no hace falta muro. */
export function wallSlots(s: GameState, base: Base): number[] {
  const slots: number[] = [];
  for (let slot = 0; slot < RING_SLOTS; slot++) {
    const p = wallPoint(base, slot);
    if (isLand(s.map, p.x, p.y)) slots.push(slot);
  }
  return slots;
}

function ringPoint(base: Point, position: number): Point {
  const angle = (position / RING_SLOTS) * Math.PI * 2;
  return { x: base.x + Math.cos(angle) * RING_RADIUS, y: base.y + Math.sin(angle) * RING_RADIUS };
}

export const wallPoint = (base: Point, slot: number) => ringPoint(base, slot + 0.5);

export const wallEnds = (base: Point, slot: number): [Point, Point] => [ringPoint(base, slot), ringPoint(base, slot + 1)];

const isWall = (b: Building) => b.type === 'wallWood' || b.type === 'wallStone';

export function wallsOf(s: GameState, base: Base) {
  return s.buildings.filter((b) => b.baseId === base.id && isWall(b));
}

export function freeWallSlot(s: GameState, base: Base): number | null {
  const taken = new Set(wallsOf(s, base).map((b) => b.slot));
  return wallSlots(s, base).find((slot) => !taken.has(slot)) ?? null;
}

/** Si queda un hueco, el enemigo entra por ahí: solo el anillo completo detiene el paso. */
export function ringClosed(s: GameState, base: Base): boolean {
  const walls = wallsOf(s, base).filter((b) => b.done);
  return walls.length > 0 && walls.length >= wallSlots(s, base).length;
}

// ---- Simulación ------------------------------------------------------------

function nearestEnemy(s: GameState, army: Army, range: number): Army | null {
  let best: Army | null = null;
  let distance = range;
  for (const other of s.armies) {
    if (other.owner === army.owner) continue;
    const d = Math.hypot(other.x - army.x, other.y - army.y);
    if (d < distance) {
      distance = d;
      best = other;
    }
  }
  return best;
}

function mergeInto(s: GameState, army: Army, base: Base) {
  base.garrison.common += army.common;
  base.garrison.heavy += army.heavy;
  s.armies.splice(s.armies.indexOf(army), 1);
}

function arrive(s: GameState, army: Army) {
  const order = army.order;
  if (order.kind === 'hold') return;
  if (order.kind === 'chase') {
    army.leg = army.path.length;
    return;
  }
  const base = ownBase(s, order.baseId);
  if (!base) {
    retreatArmy(s, army.owner, army.id);
  } else if (base.owner === army.owner) {
    mergeInto(s, army, base);
  } else if (order.kind !== 'attack') {
    army.order = { kind: 'attack', baseId: base.id, mode: 'conquer' };
  }
}

function afterVictory(s: GameState, army: Army) {
  const home = army.home !== null ? ownBase(s, army.home) : undefined;
  if (home?.owner === army.owner) assign(s, army, { kind: 'move', baseId: home.id });
  else if (army.order.kind === 'chase') {
    army.order = { kind: 'hold', x: army.x, y: army.y };
    army.path = [army];
    army.leg = 1;
  }
}

function moveArmy(s: GameState, army: Army, war: boolean) {
  const foe = war ? nearestEnemy(s, army, ENGAGE_RANGE) : null;
  army.fighting = foe !== null;
  if (foe) return;

  if (war) {
    const caught = s.expeditions.find(
      (e) => e.owner !== army.owner && Math.hypot(e.x - army.x, e.y - army.y) < ENGAGE_RANGE,
    );
    if (caught) {
      s.expeditions.splice(s.expeditions.indexOf(caught), 1);
      say(s, caught.owner, `${s.players[army.owner].name} interceptó tu expedición.`, 'bad');
    }
  }

  const order = army.order;
  if (order.kind === 'chase') {
    const prey = s.armies.find((a) => a.id === order.armyId);
    const home = army.home !== null ? ownBase(s, army.home) : undefined;
    const escaped = home && prey && Math.hypot(prey.x - home.x, prey.y - home.y) > STANCE_RADIUS[home.stance] * 1.5;
    if (!prey || escaped) {
      afterVictory(s, army);
      return;
    }
    if (s.tick % CHASE_REPATH === 0) {
      army.path = routeTo(s, army, order) ?? army.path;
      army.leg = 1;
    }
  }

  if (order.kind === 'attack') {
    const base = ownBase(s, order.baseId);
    if (!base || base.owner === army.owner) {
      if (base) mergeInto(s, army, base);
      else retreatArmy(s, army.owner, army.id);
      return;
    }
    const stop = ringClosed(s, base) ? WALL_STOP : SIEGE_RANGE;
    army.sieging = Math.hypot(base.x - army.x, base.y - army.y) <= stop;
    if (army.sieging) return;
  }

  let step = speedOf(army) / TICKS_PER_SECOND;
  while (step > 0 && army.leg < army.path.length) {
    const goal = army.path[army.leg];
    const distance = Math.hypot(goal.x - army.x, goal.y - army.y);
    if (distance > step) {
      army.x += ((goal.x - army.x) / distance) * step;
      army.y += ((goal.y - army.y) / distance) * step;
      return;
    }
    army.x = goal.x;
    army.y = goal.y;
    step -= distance;
    army.leg++;
  }
  arrive(s, army);
}

function removeBuilding(s: GameState, building: Building) {
  s.buildings.splice(s.buildings.indexOf(building), 1);
}

function closest<T extends Point>(items: T[], from: Point): T | undefined {
  return [...items].sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y))[0];
}

function shot(s: GameState, from: Point, to: Point) {
  s.shots.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y, at: s.tick });
}

function plunder(s: GameState, army: Army, base: Base) {
  const victim = s.players[base.owner];
  const thief = s.players[army.owner];
  const towers = s.buildings.filter((b) => b.baseId === base.id && b.type === 'tower').length;
  const guarded = 1 / (1 + towers * 0.25 + (wallsOf(s, base).length > 0 ? 0.25 : 0));
  for (const resource of RESOURCES) {
    const limit = Math.min(troopCount(army) * LOOT_PER_SOLDIER * guarded, LOOT_MAX);
    const amount = Math.floor(Math.min(victim.stock[resource] * LOOT_SHARE, limit));
    if (amount <= 0) continue;
    victim.stock[resource] -= amount;
    gain(s, thief, resource, amount);
  }
  say(s, victim.id, `${thief.name} saqueó tus recursos en ${base.name}.`, 'bad');
  say(s, thief.id, `Saqueo completado en ${base.name}.`, 'good');
}

function conquer(s: GameState, army: Army, base: Base) {
  const loser = base.owner;
  base.owner = army.owner;
  base.jobs = emptyJobs();
  base.effective = emptyJobs();
  base.training = [];
  base.reproProgress = 0;
  for (const c of s.citizens) {
    if (c.baseId === base.id) {
      c.owner = army.owner;
      c.job = 'idle';
      c.target = null;
      c.dest = null;
      c.via = null;
      c.state = 'idle';
    }
  }
  for (const b of s.buildings) if (b.baseId === base.id) b.owner = army.owner;
  mergeInto(s, army, base);
  say(s, loser, `¡Perdiste ${base.name}!`, 'bad');
  say(s, army.owner, `¡Conquistaste ${base.name}!`, 'good');
}

function stepSiege(s: GameState, army: Army, hits: Map<Army, number>) {
  const order = army.order;
  if (order.kind !== 'attack') return;
  const base = ownBase(s, order.baseId);
  if (!base) return;
  warnAttacked(s, base);
  const damage = attackOf(army);

  if (ringClosed(s, base)) {
    const wall = closest(wallsOf(s, base).filter((b) => b.done), army)!;
    wall.hp -= damage;
    if (wall.hp <= 0) removeBuilding(s, wall);
    return;
  }
  if (troopCount(base.garrison) > 0) {
    hits.set(army, (hits.get(army) ?? 0) + attackOf(base.garrison));
    base.wounds = wound(base.garrison, damage * (0.9 + random(s) * 0.2), base.wounds);
    return;
  }
  const tower = closest(s.buildings.filter((b) => b.baseId === base.id && b.type === 'tower' && b.done), army);
  if (tower) {
    tower.hp -= damage;
    if (tower.hp <= 0) removeBuilding(s, tower);
    return;
  }
  army.progress++;
  if (order.mode === 'raid' && army.progress >= RAID_SECONDS) {
    plunder(s, army, base);
    retreatArmy(s, army.owner, army.id);
  } else if (order.mode === 'conquer' && army.progress >= CONQUER_SECONDS) {
    conquer(s, army, base);
  }
}

function warnAttacked(s: GameState, base: Base) {
  const key = `attacked:${base.id}`;
  const last = s.warned[key];
  if (last !== undefined && s.tick - last < seconds(30)) return;
  s.warned[key] = s.tick;
  say(s, base.owner, `¡La ${base.name} está siendo atacada!`, 'bad');
}

function stepTraining(s: GameState, base: Base) {
  if (base.training.length === 0) return;
  const barracks = s.buildings.filter((b) => b.baseId === base.id && b.type === 'barracks' && b.done).length;
  for (const unit of base.training.slice(0, Math.max(1, barracks))) unit.left--;
  const ready = base.training.filter((unit) => unit.left <= 0);
  base.training = base.training.filter((unit) => unit.left > 0);
  for (const unit of ready) base.garrison[unit.kind]++;
}

/** Los defensores salen solos si un enemigo entra en el radio de su postura. */
function stepSorties(s: GameState) {
  for (const base of s.bases) {
    const radius = STANCE_RADIUS[base.stance];
    if (radius === 0 || troopCount(base.garrison) === 0) continue;
    const intruder = s.armies
      .filter((a) => a.owner !== base.owner && Math.hypot(a.x - base.x, a.y - base.y) <= radius)
      .sort((a, b) => Math.hypot(a.x - base.x, a.y - base.y) - Math.hypot(b.x - base.x, b.y - base.y))[0];
    if (!intruder) continue;
    const already = s.armies.some(
      (a) => a.owner === base.owner && a.home === base.id && a.order.kind === 'chase' && a.order.armyId === intruder.id,
    );
    if (already) continue;
    const { common, heavy } = base.garrison;
    if (sendArmy(s, base.owner, base.id, common, heavy, { kind: 'chase', armyId: intruder.id }).ok) {
      s.armies[s.armies.length - 1].home = base.id;
    }
  }
}

export function stepWar(s: GameState) {
  for (const base of s.bases) stepTraining(s, base);
  const war = atWar(s);
  for (const army of [...s.armies]) {
    if (s.armies.includes(army)) moveArmy(s, army, war);
  }
  s.shots = s.shots.filter((shotFired) => s.tick - shotFired.at < seconds(0.6));
  if (s.tick % TICKS_PER_SECOND !== 0 || !war) return;

  stepSorties(s);

  const hits = new Map<Army, number>();
  for (const army of s.armies) {
    if (!army.fighting) continue;
    const foe = nearestEnemy(s, army, ENGAGE_RANGE);
    if (foe) hits.set(foe, (hits.get(foe) ?? 0) + attackOf(army) * (0.9 + random(s) * 0.2));
  }
  for (const army of [...s.armies]) {
    if (army.sieging && !army.fighting) stepSiege(s, army, hits);
  }
  for (const tower of s.buildings.filter((b) => b.type === 'tower' && b.done)) {
    const target = closest(
      s.armies.filter((a) => a.owner !== tower.owner && Math.hypot(a.x - tower.x, a.y - tower.y) <= TOWER_RANGE),
      tower,
    );
    if (target) {
      hits.set(target, (hits.get(target) ?? 0) + TOWER_DAMAGE);
      shot(s, tower, target);
    }
  }
  for (const [army, damage] of hits) {
    if (!s.armies.includes(army)) continue;
    army.wounds = wound(army, damage, army.wounds);
    if (troopCount(army) === 0) s.armies.splice(s.armies.indexOf(army), 1);
  }
}

