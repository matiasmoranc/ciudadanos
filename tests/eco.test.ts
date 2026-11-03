import { describe, expect, it } from 'vitest';
import {
  COLLAPSE_DEATHS,
  DROUGHT_START,
  FARM_WATER,
  REGROW_SECONDS,
  RUBBLE_SECONDS,
  SAFE_MINERS,
  SAPLING_SECONDS,
  SOIL_MIN,
  STRAIN_LIMIT,
  seconds,
} from '../src/core/config';
import { isUnstable, landStatus, moistureYield, soilCap, stepEcology, yieldFactor } from '../src/core/ecology';
import { activePlayer, alertsFor, basesOf, bestSite, citizensOf, createGame, hasSource, issue, ratesFor } from '../src/core/game';
import { stepMatch } from '../src/core/match';
import type { Base, Building, GameState, ResourceNode } from '../src/core/types';

const game = (seed: number, bots = 1) =>
  createGame(seed, [
    { name: 'Verde', color: 0x4caf50, isBot: false },
    ...Array.from({ length: bots }, (_, i) => ({ name: `Bot ${i}`, color: 0x2196f3, isBot: true })),
  ]);

function finishDraft(s: GameState) {
  for (let i = 0; i < 5000 && s.phase.kind === 'draft'; i++) {
    if (activePlayer(s) === 0) issue(s, 0, { type: 'pickSite', siteId: bestSite(s)!.id });
    else stepMatch(s);
  }
}

/** Deja correr el tiempo con los turnos completos, como si nadie tocara nada. */
function run(s: GameState, secs: number) {
  for (let i = 0; i < seconds(secs) && s.phase.kind !== 'over'; i++) stepMatch(s);
}

const ready = (seed = 50) => {
  const s = game(seed);
  finishDraft(s);
  s.players.forEach((p) => Object.assign(p.stock, { food: 5000, water: 5000, wood: 500, stone: 500 }));
  return s;
};

const nodesAround = (s: GameState, base: Base, kind: ResourceNode['kind']) =>
  s.map.sites[base.siteId].nodeIds.map((id) => s.nodes[id]).filter((n) => n.kind === kind);

function forestBase(s: GameState) {
  const siteId = s.eco.findIndex((eco) => eco.trees >= 600);
  const base = s.bases[0];
  base.siteId = siteId;
  return base;
}

function clearForest(s: GameState, base: Base, share: number) {
  const trees = nodesAround(s, base, 'tree');
  trees.slice(0, Math.floor(trees.length * share)).forEach((n) => (n.amount = 0));
}

function farmAt(s: GameState, base: Base): Building {
  const farm: Building = {
    id: s.nextId++,
    type: 'farm',
    baseId: base.id,
    owner: base.owner,
    x: base.x + 30,
    y: base.y + 30,
    progress: 1,
    required: 1,
    done: true,
    level: 1,
    upgrading: false,
    users: 0,
    slot: null,
    hp: 0,
    soil: 1,
  };
  s.buildings.push(farm);
  return farm;
}

function mineBase(s: GameState, miners: number) {
  const base = s.bases[0];
  base.siteId = s.map.sites.findIndex((site) => site.biome === 'mountain' && site.nodeIds.some((id) => s.nodes[id].kind === 'rock'));
  const site = s.map.sites[base.siteId];
  base.x = site.x;
  base.y = site.y;
  base.jobs.stone = miners;
  base.effective.stone = miners;
  base.autoSurvive = false;
  return base;
}

function crack(s: GameState, base: Base, miners: number) {
  s.eco[base.siteId].strain = STRAIN_LIMIT + 20;
  while (citizensOf(s, base.id).length < miners) s.citizens.push({ ...citizensOf(s, base.id)[0], id: s.nextId++ });
  run(s, 10);
}

describe('bosque', () => {
  it('la tala baja el bosque de la región y los árboles vuelven de a poco', () => {
    const s = ready();
    const base = forestBase(s);
    clearForest(s, base, 0.4);
    run(s, 6);
    const eco = s.eco[base.siteId];
    expect(eco.forest).toBeLessThan(0.65);
    const before = eco.forest;
    run(s, REGROW_SECONDS.healthy + SAPLING_SECONDS + 30);
    expect(eco.forest).toBeGreaterThan(before);
    expect(nodesAround(s, base, 'tree').some((n) => n.growth > 0)).toBe(true);
  });

  it('un brote no se puede talar hasta que crece', () => {
    const s = ready();
    const base = forestBase(s);
    const trees = nodesAround(s, base, 'tree');
    trees.forEach((n) => (n.amount = 0));
    expect(hasSource(s, base, 'wood')).toBe(false);
    trees[0].growth = 0.5;
    expect(hasSource(s, base, 'wood')).toBe(false);
    run(s, SAPLING_SECONDS);
    expect(trees[0].amount).toBe(trees[0].max);
    expect(hasSource(s, base, 'wood')).toBe(true);
  });

  it('un bosque pelado se recupera más lento que uno sano', () => {
    const grown = (share: number) => {
      const s = ready(51);
      const base = forestBase(s);
      clearForest(s, base, share);
      const empty = () => nodesAround(s, base, 'tree').filter((n) => n.amount === 0 && n.growth === 0).length;
      const before = empty();
      run(s, 620);
      return before - empty();
    };
    expect(grown(0.3)).toBeGreaterThan(grown(0.97));
  });

  it('talar de más empobrece la tierra de la región', () => {
    const s = ready();
    const base = forestBase(s);
    clearForest(s, base, 0.97);
    run(s, 6);
    const eco = s.eco[base.siteId];
    expect(soilCap(eco)).toBeLessThan(0.8);
    expect(landStatus(s, base).notes.some((n) => n.text.startsWith('Poco bosque'))).toBe(true);
  });
});

describe('agua y sequía', () => {
  it('sin bosque llega la sequía, con aviso previo y orillas secas', () => {
    const s = ready();
    const base = forestBase(s);
    clearForest(s, base, 1);
    const shores = nodesAround(s, base, 'water');
    const said: string[] = [];
    const eco = s.eco[base.siteId];
    for (let i = 0; i < 400 && !eco.drought; i++) {
      run(s, 5);
      said.push(...s.events.map((e) => e.text));
      s.events.length = 0;
    }
    expect(eco.drought).toBe(true);
    expect(eco.moisture).toBeLessThan(DROUGHT_START);
    expect(said.some((t) => t.includes('se está secando'))).toBe(true);
    expect(said.some((t) => t.startsWith('¡Sequía'))).toBe(true);
    expect(moistureYield(eco)).toBeLessThan(1);
    expect(alertsFor(s, 0).some((a) => a.text.includes('sequía'))).toBe(true);
    if (shores.length >= 2) {
      expect(shores.some((n) => n.closed === 'dry')).toBe(true);
      expect(shores.some((n) => n.closed === null)).toBe(true);
    }
  });

  it('la región se recupera cuando deja de sufrir', () => {
    const s = ready();
    const base = forestBase(s);
    const eco = s.eco[base.siteId];
    Object.assign(eco, { moisture: 0.2, drought: true });
    nodesAround(s, base, 'water').forEach((n, i) => {
      if (i % 2) n.closed = 'dry';
    });
    run(s, 200);
    expect(eco.drought).toBe(false);
    expect(nodesAround(s, base, 'water').every((n) => n.closed === null)).toBe(true);
  });

  it('sacar demasiada agua de un solo lugar también reseca', () => {
    const s = ready();
    const base = s.bases[0];
    const eco = s.eco[base.siteId];
    for (let i = 0; i < 12; i++) {
      eco.drawn += 40;
      run(s, 5);
    }
    expect(eco.thirst).toBeGreaterThan(100);
    expect(eco.moisture).toBeLessThan(1);
  });
});

describe('fertilidad', () => {
  it('tres trabajadores cansan la tierra, y descansa sin ellos', () => {
    const s = ready();
    const base = s.bases[0];
    const farm = farmAt(s, base);
    const work = (users: number, secs: number) => {
      for (let i = 0; i < secs / 5; i++) {
        s.tick += seconds(5) - (s.tick % seconds(5));
        farm.users = users;
        stepEcology(s);
      }
    };
    work(2, 300);
    expect(farm.soil).toBe(1);
    work(3, 300);
    const tired = farm.soil;
    expect(tired).toBeLessThan(0.7);
    expect(yieldFactor(s, base, 'food', farm)).toBeLessThan(0.75);
    work(3, 600);
    expect(farm.soil).toBe(SOIL_MIN);
    work(0, 200);
    expect(farm.soil).toBeGreaterThan(tired);
  });

  it('las granjas consumen agua y eso se ve en el balance', () => {
    const s = ready();
    const base = basesOf(s, 0)[0];
    base.autoSurvive = false;
    farmAt(s, base);
    const water = s.players[0].stock.water;
    issue(s, 0, { type: 'setJob', baseId: base.id, job: 'food', delta: 2 });
    run(s, 40);
    const rate = ratesFor(s, 0).water;
    expect(rate.irrigation).toBeGreaterThan(0);
    expect(rate.irrigation).toBeLessThanOrEqual((60 / 6) * 1.25 * 2 * FARM_WATER + 0.01);
    expect(s.players[0].stock.water).toBeLessThan(water);
  });
});

describe('derrumbes', () => {
  it('avisa antes, y sacar gente de las vetas lo evita', () => {
    const s = ready();
    const base = mineBase(s, 4);
    crack(s, base, 4);
    const eco = s.eco[base.siteId];
    expect(eco.crack).not.toBeNull();
    expect(alertsFor(s, 0).some((a) => a.text.includes('grietas'))).toBe(true);
    expect(s.events.some((e) => e.text.startsWith('¡Grietas'))).toBe(true);
    base.jobs.stone = SAFE_MINERS;
    run(s, 10);
    expect(eco.crack).toBeNull();
    expect(eco.rubble).toBeNull();
  });

  it('si se ignora, mata hasta dos trabajadores y bloquea las vetas por un tiempo', () => {
    const s = ready();
    const base = mineBase(s, 4);
    for (let i = 0; i < 6; i++) s.citizens.push({ ...citizensOf(s, base.id)[0], id: s.nextId++ });
    run(s, 30);
    crack(s, base, 4);
    const eco = s.eco[base.siteId];
    const before = citizensOf(s, base.id).length;
    for (let i = 0; i < 40 && eco.crack; i++) run(s, 5);
    expect(eco.rubble).not.toBeNull();
    expect(before - citizensOf(s, base.id).length).toBeLessThanOrEqual(COLLAPSE_DEATHS);
    const blocked = nodesAround(s, base, 'rock').filter((n) => n.closed === 'rubble');
    expect(blocked.length).toBeGreaterThan(0);
    run(s, RUBBLE_SECONDS + 6);
    expect(blocked.every((n) => n.closed === null)).toBe(true);
    expect(eco.rubble).toBeNull();
  });

  it('nunca ocurre sin que el dueño haya tenido un turno', () => {
    const s = ready();
    const base = mineBase(s, 4);
    crack(s, base, 4);
    const eco = s.eco[base.siteId];
    eco.crackAt = s.tick;
    eco.crackTurn = false;
    s.tick += seconds(5) - (s.tick % seconds(5));
    stepEcology(s);
    expect(eco.crack).not.toBeNull();
    expect(eco.rubble).toBeNull();
    eco.crackTurn = true;
    s.tick += seconds(5);
    stepEcology(s);
    expect(eco.rubble).not.toBeNull();
  });

  it('las zonas firmes no se derrumban', () => {
    const s = ready();
    const base = s.bases[0];
    base.siteId = s.map.sites.findIndex((site) => site.biome === 'plains');
    expect(isUnstable(s, base)).toBe(false);
    base.effective.stone = 8;
    s.eco[base.siteId].strain = STRAIN_LIMIT * 3;
    run(s, 30);
    expect(s.eco[base.siteId].crack).toBeNull();
  });

  it('un bot saca gente de las vetas cuando aparecen grietas', () => {
    const s = game(52);
    finishDraft(s);
    const base = s.bases.find((b) => b.owner === 1)!;
    s.eco[base.siteId].crack = { x: base.x, y: base.y };
    s.eco[base.siteId].crackAt = s.tick + seconds(90);
    for (let i = 0; i < 5; i++) s.citizens.push({ ...citizensOf(s, base.id)[0], id: s.nextId++ });
    s.players[1].stock.food = 500;
    s.players[1].stock.water = 500;
    run(s, 60);
    expect(base.jobs.stone + base.jobs.iron + base.jobs.gold).toBeLessThanOrEqual(SAFE_MINERS);
  });
});

describe('partida completa', () => {
  it('es determinista y los efectos no son demasiado frecuentes', () => {
    const play = () => {
      const s = game(53, 3);
      finishDraft(s);
      for (const base of basesOf(s, 0)) issue(s, 0, { type: 'setJob', baseId: base.id, job: 'food', delta: 2 });
      let droughts = 0;
      let collapses = 0;
      for (let i = 0; i < seconds(2700) && s.phase.kind !== 'over'; i++) {
        run(s, 0.1);
        for (const event of s.events.splice(0)) {
          if (event.text.startsWith('¡Sequía')) droughts++;
          if (event.text.startsWith('¡Derrumbe')) collapses++;
        }
      }
      return { droughts, collapses, tick: s.tick, forest: s.eco.map((e) => e.forest), rng: s.rng };
    };
    const a = play();
    console.log('sequías', a.droughts, 'derrumbes', a.collapses, 'tick', a.tick);
    expect(play()).toEqual(a);
    expect(a.droughts + a.collapses).toBeLessThan(25);
  }, 240000);
});
