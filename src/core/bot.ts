import { BIRTH_COST, CONSUMPTION_PER_MIN, JOBS, REPRODUCTION_SECONDS, WORK_SECONDS } from './config';
import {
  basesOf,
  capacityOf,
  citizensOf,
  hasSource,
  issue,
  missingFor,
  populationOf,
  storageOf,
} from './game';
import type { Base, BuildingType, GameState, Job, Player } from './types';

/** Decide un turno completo usando solo comandos normales. */
export function playBotTurn(s: GameState, player: number) {
  const owner = s.players[player];
  const bases = basesOf(s, player);
  planBuildings(s, owner, bases);
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
  const main = [...bases].sort((a, b) => citizensOf(s, b.id).length - citizensOf(s, a.id).length)[0];
  if (full && main && !pending('depot')) order(main, 'depot');
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
  const largestFirst = [...bases].sort((a, b) => citizensOf(s, b.id).length - citizensOf(s, a.id).length);
  for (const base of largestFirst) {
    const population = citizensOf(s, base.id).length;
    const want: Record<Job, number> = { wood: 0, stone: 0, food: 0, water: 0, build: 0, reproduce: 0 };
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
    if (s.buildings.some((b) => b.baseId === base.id && !b.done)) take('build', population >= 6 ? 2 : 1);

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
