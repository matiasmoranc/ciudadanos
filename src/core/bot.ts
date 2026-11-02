import {
  BIRTH_COST,
  CONSUMPTION_PER_MIN,
  EXPEDITION_COST,
  JOBS,
  MARKET_VALUE,
  REPRODUCTION_SECONDS,
  RESOURCES,
  SOLDIERS,
  TRUCE_ROUNDS,
  UPGRADES,
  WORK_SECONDS,
} from './config';
import {
  basesOf,
  bestSite,
  capacityOf,
  citizensOf,
  emptyJobs,
  hasSource,
  issue,
  missingCost,
  missingFor,
  needsWork,
  populationOf,
  random,
  storageOf,
  upgradable,
} from './game';
import { canPay, marketPrice } from './trade';
import { freeWallSlot, ringClosed, soldiersOf, troopCount } from './war';
import type { Base, BuildingType, GameState, Job, Offer, Player, ResourceId, Stock } from './types';

const MAX_BASES = 5;
const VITAL_RESERVE = 18;

/** Decide un turno completo usando solo comandos normales. */
export function playBotTurn(s: GameState, player: number) {
  const owner = s.players[player];
  const bases = basesOf(s, player);
  planBarracks(s, owner, bases);
  planBuildings(s, owner, bases);
  planExpansion(s, owner, basesOf(s, player));
  planMilitary(s, owner, basesOf(s, player));
  assignWorkers(s, owner, bases);
  issue(s, player, { type: 'endTurn' });
}

function planBuildings(s: GameState, owner: Player, bases: Base[]) {
  const pending = (type: BuildingType, base?: Base) =>
    s.buildings.some((b) => b.owner === owner.id && b.type === type && !b.done && (!base || b.baseId === base.id));
  const order = (base: Base, type: BuildingType) => {
    if (missingFor(owner, type).length === 0) issue(s, owner.id, { type: 'build', baseId: base.id, building: type });
  };

  for (const base of bases) {
    const population = citizensOf(s, base.id).length;
    if (!hasSource(s, base, 'water') && !pending('well', base)) order(base, 'well');
    if (!hasSource(s, base, 'food') && !pending('farm', base)) order(base, 'farm');
    if (population >= capacityOf(s, base) - 1 && !pending('house', base)) order(base, 'house');
    const farms = s.buildings.filter((b) => b.baseId === base.id && b.type === 'farm').length;
    if (population >= 8 && farms < Math.floor(population / 8) && !pending('farm', base)) order(base, 'farm');
  }

  const cap = storageOf(s, owner.id);
  const full = owner.stock.wood > cap * 0.85 || owner.stock.stone > cap * 0.85;
  const main = largestFirst(s, bases)[0];
  if (full && main && !pending('depot')) order(main, 'depot');

  for (const base of bases) {
    for (const type of Object.keys(UPGRADES) as BuildingType[]) {
      const affordable = missingCost(owner, UPGRADES[type]!.cost).length === 0;
      if (!affordable || upgradable(s, base, type).length === 0) continue;
      if (owner.stock.wood < 40 || owner.stock.stone < 20) continue;
      issue(s, owner.id, { type: 'upgrade', baseId: base.id, building: type });
      break;
    }
  }
}

function planExpansion(s: GameState, owner: Player, bases: Base[]) {
  const travelling = s.expeditions.some((e) => e.owner === owner.id);
  if (travelling || bases.length >= MAX_BASES || populationOf(s, owner.id) < 12) return;
  if (missingCost(owner, EXPEDITION_COST).length > 0) return;
  const origin = largestFirst(s, bases)[0];
  const site = bestSite(s);
  if (origin && site && citizensOf(s, origin.id).length >= 6) {
    issue(s, owner.id, { type: 'foundBase', baseId: origin.id, siteId: site.id });
  }
}

/** Va primero: si no, casas y torres gastan la madera y el cuartel nunca llega. */
function planBarracks(s: GameState, owner: Player, bases: Base[]) {
  const main = largestFirst(s, bases)[0];
  if (!main || populationOf(s, owner.id) < 10) return;
  if (s.buildings.some((b) => b.owner === owner.id && b.type === 'barracks')) return;
  if (missingFor(owner, 'barracks').length === 0) {
    issue(s, owner.id, { type: 'build', baseId: main.id, building: 'barracks' });
  }
}

function planMilitary(s: GameState, owner: Player, bases: Base[]) {
  const total = populationOf(s, owner.id);
  const main = largestFirst(s, bases)[0];
  if (!main || total < 10) return;
  const has = (type: BuildingType, base: Base) => s.buildings.some((b) => b.baseId === base.id && b.type === type);
  const threatened = s.armies.some(
    (a) => a.owner !== owner.id && a.order.kind === 'attack' && bases.some((b) => b.id === (a.order as { baseId: number }).baseId),
  );

  for (const base of bases) {
    const worthy = threatened || citizensOf(s, base.id).length >= 10;
    if (worthy && !has('tower', base) && missingFor(owner, 'tower').length === 0) {
      issue(s, owner.id, { type: 'build', baseId: base.id, building: 'tower' });
    }
  }
  if (total >= 24 && owner.stock.wood > 120 && freeWallSlot(s, main) !== null) {
    for (let i = 0; i < 12 && owner.stock.wood > 60; i++) {
      issue(s, owner.id, { type: 'build', baseId: main.id, building: 'wallWood' });
    }
  }

  const wanted = Math.floor(total * (threatened ? 0.45 : 0.3));
  for (const base of bases.filter((b) => has('barracks', b))) {
    for (let i = 0; i < 6 && soldiersOf(s, owner.id) < wanted; i++) {
      const kind = missingCost(owner, SOLDIERS.heavy.cost).length === 0 ? 'heavy' : 'common';
      if (owner.stock.food < 22 || !issue(s, owner.id, { type: 'train', baseId: base.id, kind }).ok) break;
    }
  }
  planAttack(s, owner, bases);
}

function planAttack(s: GameState, owner: Player, bases: Base[]) {
  if (s.round <= TRUCE_ROUNDS) return;
  const origin = [...bases].sort((a, b) => troopCount(b.garrison) - troopCount(a.garrison))[0];
  if (!origin || troopCount(origin.garrison) < 4) return;
  const strength = (base: Base) =>
    troopCount(base.garrison) +
    s.buildings.filter((b) => b.baseId === base.id && b.type === 'tower').length * 4 +
    (ringClosed(s, base) ? 5 : 0);
  const target = s.bases
    .filter((b) => b.owner !== owner.id)
    .sort((a, b) => Math.hypot(a.x - origin.x, a.y - origin.y) - Math.hypot(b.x - origin.x, b.y - origin.y))
    .find((b) => strength(b) * 1.2 <= troopCount(origin.garrison));
  if (!target) return;
  const mode = strength(target) <= 2 ? 'conquer' : 'raid';
  issue(s, owner.id, {
    type: 'sendArmy',
    baseId: origin.id,
    common: Math.ceil(origin.garrison.common * 0.8),
    heavy: Math.ceil(origin.garrison.heavy * 0.8),
    order: { kind: 'attack', baseId: target.id, mode },
  });
}

function largestFirst(s: GameState, bases: Base[]) {
  return [...bases].sort((a, b) => citizensOf(s, b.id).length - citizensOf(s, a.id).length);
}

function assignWorkers(s: GameState, owner: Player, bases: Base[]) {
  const total = populationOf(s, owner.id);
  if (total === 0) return;

  const perFood = 60 / WORK_SECONDS.forage;
  const perWater = 60 / WORK_SECONDS.water;
  // Cada pareja también gasta comida y agua en nacimientos: hay que producir de más.
  const pairs = total < 8 ? 0 : total < 16 ? 1 : 2;
  const births = (60 / REPRODUCTION_SECONDS) * pairs;
  const feed = (cost: number, rate: number) => Math.ceil((total * CONSUMPTION_PER_MIN + births * cost) / rate);
  let foodLeft = feed(BIRTH_COST.food, perFood);
  let waterLeft = feed(BIRTH_COST.water, perWater);

  // La base más grande carga con la supervivencia; así la chica puede crecer.
  for (const base of largestFirst(s, bases)) {
    const population = citizensOf(s, base.id).length;
    const want = emptyJobs();
    let free = population;

    const take = (job: Job, amount: number) => {
      const given = Math.max(0, Math.min(free, amount));
      want[job] += given;
      free -= given;
      return given;
    };

    if (hasSource(s, base, 'food')) foodLeft -= take('food', foodLeft);
    if (hasSource(s, base, 'water')) waterLeft -= take('water', waterLeft);

    const room = population < capacityOf(s, base);
    if (room && free >= 2 && owner.stock.food > 20 && owner.stock.water > 20) {
      take('reproduce', population >= 10 ? 4 : 2);
    }
    if (s.buildings.some((b) => b.baseId === base.id && needsWork(b))) take('build', population >= 6 ? 2 : 1);
    if (population >= 5 && hasSource(s, base, 'iron')) take('iron', population >= 12 ? 3 : 1);
    if (population >= 10 && hasSource(s, base, 'gold')) take('gold', 1);

    const woodFirst = owner.stock.wood <= owner.stock.stone * 1.6;
    const order: Job[] = woodFirst ? ['wood', 'stone'] : ['stone', 'wood'];
    const usable = order.filter((job) => hasSource(s, base, job));
    if (usable.length === 2) {
      const split = Math.ceil(free * 0.6);
      take(usable[0], split);
      take(usable[1], free);
    } else if (usable.length === 1) {
      take(usable[0], free);
    } else {
      take(hasSource(s, base, 'food') ? 'food' : 'water', free);
    }

    applyJobs(s, owner, base, want);
  }
}

function applyJobs(s: GameState, owner: Player, base: Base, want: Record<Job, number>) {
  for (const job of JOBS) {
    const delta = want[job] - base.jobs[job];
    if (delta < 0) issue(s, owner.id, { type: 'setJob', baseId: base.id, job, delta });
  }
  for (const job of JOBS) {
    const delta = want[job] - base.jobs[job];
    if (delta > 0) issue(s, owner.id, { type: 'setJob', baseId: base.id, job, delta });
  }
}

// ---- Comercio --------------------------------------------------------------

/** Lo que vale un recurso para este bot: lo escaso vale más que lo que le sobra. */
function worth(owner: Player, resource: ResourceId): number {
  const stock = owner.stock[resource];
  const scarcity = stock < 25 ? 2 : stock < 60 ? 1.3 : stock > 180 ? 0.6 : 1;
  return MARKET_VALUE[resource] * scarcity;
}

const valueOf = (owner: Player, stock: Stock) =>
  RESOURCES.reduce((sum, resource) => sum + (stock[resource] ?? 0) * worth(owner, resource), 0);

function keepsReserve(owner: Player, pay: Stock) {
  return (['food', 'water'] as const).every(
    (resource) => (pay[resource] ?? 0) === 0 || owner.stock[resource] - (pay[resource] ?? 0) >= VITAL_RESERVE,
  );
}

function answerOffer(s: GameState, owner: Player, offer: Offer) {
  const received = valueOf(owner, offer.give);
  const paid = valueOf(owner, offer.want);
  const affordable = canPay(owner, offer.want) && keepsReserve(owner, offer.want);
  if (affordable && received >= paid * 1.1) {
    issue(s, owner.id, { type: 'respond', offerId: offer.id, accept: true });
    return;
  }
  // Regatea una sola vez: una contraoferta nunca recibe otra contraoferta.
  const ratio = received / paid / 1.1;
  if (affordable && offer.counterOf === null && ratio >= 0.55) {
    const give: Stock = {};
    for (const resource of RESOURCES) {
      const amount = Math.floor((offer.want[resource] ?? 0) * ratio);
      if (amount > 0) give[resource] = amount;
    }
    if (Object.keys(give).length > 0) {
      issue(s, owner.id, { type: 'counter', offerId: offer.id, give, want: offer.give });
      return;
    }
  }
  issue(s, owner.id, { type: 'respond', offerId: offer.id, accept: false });
}

function tradeTurn(s: GameState, owner: Player) {
  const hungry = (['food', 'water'] as const).find((resource) => owner.stock[resource] < 15);
  const richest = RESOURCES.filter((r) => r !== 'food' && r !== 'water').sort(
    (a, b) => owner.stock[b] * MARKET_VALUE[b] - owner.stock[a] * MARKET_VALUE[a],
  )[0];
  if (hungry && owner.stock[richest] >= marketPrice(richest, hungry)) {
    issue(s, owner.id, { type: 'market', give: richest, want: hungry });
  }
  const spare = owner.stock[richest] - marketPrice(richest, 'iron');
  if (populationOf(s, owner.id) >= 10 && owner.stock.iron < 15 && richest !== 'iron' && spare >= 40) {
    issue(s, owner.id, { type: 'market', give: richest, want: 'iron' });
  }

  const basics: ResourceId[] = populationOf(s, owner.id) >= 10 ? ['wood', 'stone', 'iron', 'water', 'food'] : ['wood', 'stone', 'water', 'food'];
  const need = [...basics].sort((a, b) => owner.stock[a] - owner.stock[b])[0];
  const surplus = RESOURCES.filter((r) => r !== need && r !== 'gold').sort((a, b) => owner.stock[b] - owner.stock[a])[0];
  if (owner.stock[need] >= 45 || owner.stock[surplus] < 60 || random(s) > 0.6) return;
  const want = need === 'iron' ? 6 : 15;
  const give = Math.ceil(((want * MARKET_VALUE[need]) / MARKET_VALUE[surplus]) * 1.2);
  issue(s, owner.id, { type: 'propose', to: null, give: { [surplus]: give }, want: { [need]: want } });
}

/** Un tick de la fase de comercio para los jugadores que maneja la máquina. */
export function stepBotTrade(s: GameState) {
  if (s.phase.kind !== 'trade') return;
  for (const offer of [...s.offers]) {
    if (offer.status !== 'open' || s.tick < offer.respondAt) continue;
    for (const key of Object.keys(offer.responses)) {
      const player = s.players[Number(key)];
      if (player.isBot && offer.status === 'open' && offer.responses[player.id] === 'pending') {
        answerOffer(s, player, offer);
      }
    }
  }

  const phase = s.phase;
  const active = s.players[phase.player];
  if (!active.isBot || s.tick < phase.botActAt) return;
  if (!phase.acted) {
    phase.acted = true;
    tradeTurn(s, active);
  }
  if (!s.offers.some((o) => o.status === 'open')) issue(s, active.id, { type: 'endTurn' });
}
