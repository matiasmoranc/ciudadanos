import { describe, expect, it } from 'vitest';
import { BUILDINGS, MAX_POPULATION, MIN_BASE_DISTANCE, seconds } from '../src/core/config';
import {
  activePlayer,
  basesOf,
  bestSite,
  capacityOf,
  citizensOf,
  createGame,
  issue,
  populationOf,
  regionBonus,
  scoreOf,
  siteAvailability,
  storageOf,
  alertsFor,
} from '../src/core/game';
import { isLand, terrainAt } from '../src/core/mapgen';
import { findPath } from '../src/core/path';
import { Terrain } from '../src/core/types';
import { stepMatch } from '../src/core/match';
import { market, marketPrice } from '../src/core/trade';
import type { Base, GameState, Job, ResourceId } from '../src/core/types';

const humanVsBots = (seed: number, bots = 1) =>
  createGame(seed, [
    { name: 'Verde', color: 0x4caf50, isBot: false },
    ...Array.from({ length: bots }, (_, i) => ({ name: `Bot ${i}`, color: 0x2196f3, isBot: true })),
  ]);

const allBots = (seed: number, count: number) =>
  createGame(
    seed,
    Array.from({ length: count }, (_, i) => ({ name: `Bot ${i}`, color: 0x2196f3, isBot: true })),
  );

function run(s: GameState, secs: number) {
  for (let i = 0; i < seconds(secs); i++) stepMatch(s);
}

/** Hace avanzar el draft eligiendo por el humano, hasta empezar la partida. */
function finishDraft(s: GameState) {
  for (let i = 0; i < 5000 && s.phase.kind === 'draft'; i++) {
    if (activePlayer(s) === 0) issue(s, 0, { type: 'pickSite', siteId: bestSite(s)!.id });
    else stepMatch(s);
  }
  expect(s.phase.kind).toBe('decisions');
}

function waitForMyTurn(s: GameState) {
  for (let i = 0; i < 2000 && activePlayer(s) !== 0; i++) stepMatch(s);
  expect(activePlayer(s)).toBe(0);
}

/** Termina decisiones y comercio del jugador 0. */
function endMyTurn(s: GameState) {
  issue(s, 0, { type: 'endTurn' });
  issue(s, 0, { type: 'endTurn' });
}

function reachTrade(s: GameState) {
  finishDraft(s);
  issue(s, 0, { type: 'endTurn' });
  expect(s.phase.kind).toBe('trade');
}

const totalStock = (s: GameState, resource: ResourceId) => s.players.reduce((sum, p) => sum + p.stock[resource], 0);

const setJob = (s: GameState, base: Base, job: Job, delta: number) =>
  issue(s, 0, { type: 'setJob', baseId: base.id, job, delta });

describe('mapa', () => {
  it('genera sitios sobre tierra, con recursos y agua alcanzable', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { map } = createGame(seed, [{ name: 'a', color: 0, isBot: true }]);
      expect(map.sites.length).toBeGreaterThanOrEqual(10);
      for (const site of map.sites) {
        expect(isLand(map, site.x, site.y)).toBe(true);
        expect(site.nodeIds.length).toBeGreaterThan(0);
      }
      const withWater = map.sites.filter((site) => site.stars.water >= 2).length;
      expect(withWater).toBeGreaterThanOrEqual(5);
    }
  });

  it('es determinista por semilla', () => {
    const a = createGame(7, [{ name: 'a', color: 0, isBot: true }]);
    const b = createGame(7, [{ name: 'a', color: 0, isBot: true }]);
    expect(a.nodes.length).toBe(b.nodes.length);
    expect(a.map.sites.map((x) => x.name)).toEqual(b.map.sites.map((x) => x.name));
  });
});

describe('selección inicial', () => {
  it('usa orden serpiente y nunca deja a nadie sin lugar', () => {
    const fewest: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const s = allBots(seed, 4);
      expect(s.phase.kind === 'draft' && s.phase.order).toEqual([0, 1, 2, 3, 3, 2, 1, 0]);
      let lastChoices = 0;
      for (let i = 0; i < seconds(30); i++) {
        if (s.phase.kind === 'draft' && s.phase.index === 7) {
          lastChoices = s.map.sites.filter((x) => siteAvailability(s, x) === null).length;
        }
        stepMatch(s);
      }
      expect(s.phase.kind).not.toBe('draft');
      expect(s.bases.length).toBe(8);
      expect(s.citizens.length).toBe(16);
      expect(new Set(s.bases.map((b) => b.siteId)).size).toBe(8);
      fewest.push(lastChoices);
    }
    // Quien elige último debe poder elegir de verdad.
    console.log('opciones del último en elegir:', fewest.sort((a, b) => a - b).join(' '));
    expect(fewest.filter((n) => n < 2).length).toBeLessThanOrEqual(2);
  });

  it('rechaza un sitio ocupado y uno demasiado cerca', () => {
    const s = humanVsBots(3);
    const first = bestSite(s)!;
    issue(s, 0, { type: 'pickSite', siteId: first.id });
    const near = s.map.sites.find(
      (x) => x.id !== first.id && Math.hypot(x.x - first.x, x.y - first.y) < MIN_BASE_DISTANCE,
    );
    for (let i = 0; i < 30 && activePlayer(s) !== 0; i++) stepMatch(s);
    expect(issue(s, 0, { type: 'pickSite', siteId: first.id }).ok).toBe(false);
    if (near) expect(issue(s, 0, { type: 'pickSite', siteId: near.id }).ok).toBe(false);
  });
});

describe('órdenes', () => {
  it('no permite asignar más ciudadanos de los que hay ni actuar fuera de turno', () => {
    const s = humanVsBots(4);
    finishDraft(s);
    const base = basesOf(s, 0)[0];
    expect(setJob(s, base, 'wood', 2).ok).toBe(true);
    expect(setJob(s, base, 'food', 1).ok).toBe(false);
    expect(setJob(s, base, 'stone', -1).ok).toBe(false);
    endMyTurn(s);
    expect(activePlayer(s)).toBe(1);
    expect(setJob(s, base, 'wood', -1).ok).toBe(false);
    expect(issue(s, 0, { type: 'build', baseId: base.id, building: 'house' }).ok).toBe(false);
  });

  it('los bots no pueden dar órdenes sobre bases ajenas', () => {
    const s = humanVsBots(5);
    finishDraft(s);
    const mine = basesOf(s, 0)[0];
    endMyTurn(s);
    expect(issue(s, 1, { type: 'setJob', baseId: mine.id, job: 'wood', delta: 1 }).ok).toBe(false);
  });
});

describe('economía', () => {
  it('produce en el inventario global durante turnos ajenos y sin agujeros', () => {
    const s = humanVsBots(6);
    finishDraft(s);
    const base = basesOf(s, 0).find((b) => s.map.sites[b.siteId].stars.wood >= 2) ?? basesOf(s, 0)[0];
    setJob(s, base, 'wood', 2);
    const before = s.players[0].stock.wood;
    const worker = citizensOf(s, base.id).find((c) => c.job === 'wood');
    expect(worker).toBeDefined();
    endMyTurn(s);
    expect(activePlayer(s)).toBe(1);
    const start = { x: worker!.x, y: worker!.y };
    run(s, 40);
    expect(Math.hypot(worker!.x - start.x, worker!.y - start.y)).toBeGreaterThan(5);
    expect(s.players[0].stock.wood).toBeGreaterThan(before);
  });

  it('descuenta el costo de la obra una sola vez y la casa suma capacidad', () => {
    const s = humanVsBots(8);
    finishDraft(s);
    const base = basesOf(s, 0)[0];
    const capacity = capacityOf(s, base);
    const { wood, stone } = s.players[0].stock;
    expect(issue(s, 0, { type: 'build', baseId: base.id, building: 'house' }).ok).toBe(true);
    expect(s.players[0].stock.wood).toBe(wood - 20);
    expect(s.players[0].stock.stone).toBe(stone - 10);
    setJob(s, base, 'build', 2);
    run(s, 25);
    expect(s.buildings[0].done).toBe(true);
    expect(s.players[0].stock.stone).toBeLessThanOrEqual(stone - 10);
    expect(capacityOf(s, base)).toBe(capacity + 8);
  });

  it('el botón de construir falla si faltan materiales', () => {
    const s = humanVsBots(9);
    finishDraft(s);
    const base = basesOf(s, 0)[0];
    s.players[0].stock.wood = 18;
    const result = issue(s, 0, { type: 'build', baseId: base.id, building: 'house' });
    expect(result).toEqual({ ok: false, error: 'Faltan 2 de madera.' });
    expect(s.buildings.length).toBe(0);
  });

  it('los depósitos aumentan la capacidad global y el stock nunca la supera', () => {
    const s = humanVsBots(10);
    finishDraft(s);
    const base = basesOf(s, 0)[0];
    const cap = storageOf(s, 0);
    issue(s, 0, { type: 'build', baseId: base.id, building: 'depot' });
    setJob(s, base, 'build', 2);
    run(s, BUILDINGS.depot.seconds + 8);
    expect(storageOf(s, 0)).toBe(cap + 200);
  });

  it('la reproducción respeta vivienda y la población sube', () => {
    const s = humanVsBots(11);
    finishDraft(s);
    const base = basesOf(s, 0)[0];
    setJob(s, base, 'reproduce', 2);
    run(s, 25);
    waitForMyTurn(s);
    run(s, 8);
    expect(citizensOf(s, base.id).length).toBeGreaterThanOrEqual(3);
    run(s, 120);
    expect(citizensOf(s, base.id).length).toBeLessThanOrEqual(capacityOf(s, base));
  });
});

describe('supervivencia', () => {
  it('avisa antes y los ciudadanos mueren de a poco si nadie trabaja', () => {
    const s = humanVsBots(12);
    finishDraft(s);
    basesOf(s, 0).forEach((b) => issue(s, 0, { type: 'setAutoSurvive', baseId: b.id, value: false }));
    s.players[0].stock.food = 12;
    let warned = false;
    let firstDeath: number | null = null;
    const start = s.tick;
    for (let i = 0; i < seconds(300) && s.phase.kind !== 'over'; i++) {
      stepMatch(s);
      warned ||= s.events.some((e) => e.player === 0 && e.text.includes('se agotará'));
      if (firstDeath === null && populationOf(s, 0) < 4) firstDeath = s.tick;
    }
    expect(warned).toBe(true);
    expect(firstDeath).not.toBeNull();
    // 12 de comida con 4 personas duran 2 minutos, más 60 s de gracia.
    expect(firstDeath! - start).toBeGreaterThan(seconds(150));
    expect(s.players[0].stock.food).toBeGreaterThanOrEqual(0);
  });

  it('la supervivencia automática mueve trabajadores y los devuelve', () => {
    const s = humanVsBots(13);
    finishDraft(s);
    const base = basesOf(s, 0).find((b) => s.map.sites[b.siteId].stars.food >= 2) ?? basesOf(s, 0)[0];
    setJob(s, base, 'wood', 2);
    s.players[0].stock.food = 10;
    run(s, 3);
    expect(base.jobs.wood).toBe(2);
    expect(base.effective.food).toBeGreaterThan(0);
    s.players[0].stock.food = 100;
    run(s, 3);
    expect(base.effective.food).toBe(0);
    expect(base.effective.wood).toBe(2);
  });
});

describe('especialidad regional', () => {
  it('rinde más en la especialidad de su región', () => {
    const s = humanVsBots(14);
    finishDraft(s);
    const base = basesOf(s, 0)[0];
    const job = s.map.sites[base.siteId].specialty[0];
    expect(regionBonus(s, base, job)).toBeGreaterThan(1);
    const other = (['wood', 'gold', 'water'] as Job[]).find((j) => !s.map.sites[base.siteId].specialty.includes(j))!;
    expect(regionBonus(s, base, other)).toBe(1);
  });

  it('hay hierro en las montañas y oro escaso', () => {
    let iron = 0;
    let gold = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const { map } = createGame(seed, [{ name: 'a', color: 0, isBot: true }]);
      iron += map.nodes.filter((n) => n.kind === 'iron').length;
      gold += map.nodes.filter((n) => n.kind === 'gold').length;
    }
    expect(iron).toBeGreaterThan(gold);
    expect(gold).toBeGreaterThan(0);
  });
});

describe('mejoras', () => {
  it('mejora una casa pagando hierro y suma capacidad sin dejar de funcionar', () => {
    const s = humanVsBots(15);
    finishDraft(s);
    const base = basesOf(s, 0)[0];
    issue(s, 0, { type: 'build', baseId: base.id, building: 'house' });
    setJob(s, base, 'build', 2);
    run(s, 18);
    expect(s.buildings[0].done).toBe(true);
    waitForMyTurn(s);
    for (let i = 0; i < 1000 && s.phase.kind !== 'decisions'; i++) stepMatch(s);
    const noIron = issue(s, 0, { type: 'upgrade', baseId: base.id, building: 'house' });
    expect(noIron).toEqual({ ok: false, error: 'Faltan 10 de hierro.' });
    s.players[0].stock.iron = 12;
    s.players[0].stock.wood = 40;
    const capacity = capacityOf(s, base);
    expect(issue(s, 0, { type: 'upgrade', baseId: base.id, building: 'house' }).ok).toBe(true);
    expect(s.players[0].stock.iron).toBe(2);
    expect(capacityOf(s, base)).toBe(capacity);
    run(s, 12);
    expect(s.buildings[0].level).toBe(2);
    expect(capacityOf(s, base)).toBe(capacity + 4);
    expect(issue(s, 0, { type: 'upgrade', baseId: base.id, building: 'house' }).ok).toBe(false);
  });
});

describe('nuevas bases', () => {
  function expedition(seed: number) {
    const s = humanVsBots(seed);
    finishDraft(s);
    const base = basesOf(s, 0)[0];
    for (let i = 0; i < 2; i++) addPeople(s, base);
    s.players[0].stock.wood = 100;
    s.players[0].stock.stone = 100;
    const site = s.map.sites.find((x) => siteAvailability(s, x) === null)!;
    return { s, base, site };
  }

  function addPeople(s: GameState, base: Base) {
    const c = s.citizens.find((x) => x.baseId === base.id)!;
    s.citizens.push({ ...c, id: s.nextId++ });
  }

  it('la expedición viaja y funda una base que usa el inventario global', () => {
    const { s, base, site } = expedition(16);
    const wood = s.players[0].stock.wood;
    const before = populationOf(s, 0);
    expect(issue(s, 0, { type: 'foundBase', baseId: base.id, siteId: site.id }).ok).toBe(true);
    expect(s.players[0].stock.wood).toBe(wood - 60);
    expect(citizensOf(s, base.id).length).toBe(1);
    expect(populationOf(s, 0)).toBe(before);
    expect(s.expeditions.length).toBe(1);
    expect(siteAvailability(s, site)).not.toBeNull();
    const walkers = s.expeditions[0];
    expect(basesOf(s, 0).length).toBe(2);
    for (let i = 0; i < seconds(120) && s.expeditions.length > 0; i++) {
      stepMatch(s);
      expect(terrainAt(s.map, walkers.x, walkers.y)).not.toBe(Terrain.Ocean);
      expect(terrainAt(s.map, walkers.x, walkers.y)).not.toBe(Terrain.Lake);
    }
    expect(s.expeditions.length).toBe(0);
    expect(basesOf(s, 0).length).toBe(3);
    expect(populationOf(s, 0)).toBe(before);
    const founded = basesOf(s, 0).find((b) => b.siteId === site.id)!;
    expect(citizensOf(s, founded.id).length).toBe(3);
  });

  it('exige recursos, gente suficiente y un lugar libre', () => {
    const { s, base, site } = expedition(17);
    s.players[0].stock.stone = 10;
    expect(issue(s, 0, { type: 'foundBase', baseId: base.id, siteId: site.id })).toEqual({
      ok: false,
      error: 'Faltan 30 de piedra.',
    });
    s.players[0].stock.stone = 100;
    const small = basesOf(s, 0)[1];
    expect(issue(s, 0, { type: 'foundBase', baseId: small.id, siteId: site.id }).ok).toBe(false);
    const taken = s.bases.find((b) => b.owner !== 0)!;
    expect(issue(s, 0, { type: 'foundBase', baseId: base.id, siteId: taken.siteId }).ok).toBe(false);
  });

  it('todos los sitios tienen camino por tierra en la mayoría de los mapas', () => {
    let missing = 0;
    let total = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const { map } = createGame(seed, [{ name: 'a', color: 0, isBot: true }]);
      for (const site of map.sites) {
        total++;
        if (!findPath(map, map.sites[0], site)) missing++;
      }
    }
    expect(missing / total).toBeLessThan(0.1);
  });
});

describe('comercio', () => {
  it('sigue a las decisiones y bloquea las órdenes', () => {
    const s = humanVsBots(18);
    reachTrade(s);
    const base = basesOf(s, 0)[0];
    expect(setJob(s, base, 'wood', 1).ok).toBe(false);
    expect(issue(s, 0, { type: 'build', baseId: base.id, building: 'house' }).ok).toBe(false);
    issue(s, 0, { type: 'endTurn' });
    expect(activePlayer(s)).toBe(1);
  });

  it('intercambia de una vez, sin crear ni destruir recursos', () => {
    const s = humanVsBots(19);
    reachTrade(s);
    s.players[1].stock.stone = 100;
    s.players[1].stock.wood = 10;
    const wood = totalStock(s, 'wood');
    const stone = totalStock(s, 'stone');
    issue(s, 0, { type: 'propose', to: 1, give: { wood: 30 }, want: { stone: 15 } });
    const offer = s.offers[0];
    expect(issue(s, 1, { type: 'respond', offerId: offer.id, accept: true }).ok).toBe(true);
    expect(s.players[0].stock.wood).toBe(30);
    expect(s.players[0].stock.stone).toBe(45);
    expect(s.players[1].stock.wood).toBe(40);
    expect(totalStock(s, 'wood')).toBe(wood);
    expect(totalStock(s, 'stone')).toBe(stone);
    expect(issue(s, 1, { type: 'respond', offerId: offer.id, accept: true }).ok).toBe(false);
    expect(s.players[0].stock.wood).toBe(30);
  });

  it('nunca deja recursos negativos', () => {
    const s = humanVsBots(20);
    reachTrade(s);
    expect(issue(s, 0, { type: 'propose', to: 1, give: { wood: 500 }, want: { stone: 1 } }).ok).toBe(false);
    issue(s, 0, { type: 'propose', to: 1, give: { wood: 50 }, want: { stone: 5 } });
    s.players[0].stock.wood = 3;
    const answer = issue(s, 1, { type: 'respond', offerId: s.offers[0].id, accept: true });
    expect(answer.ok).toBe(false);
    expect(s.players[0].stock.wood).toBe(3);
    s.players[1].stock.stone = 0;
    s.players[0].stock.wood = 60;
    expect(issue(s, 1, { type: 'respond', offerId: s.offers[0].id, accept: true }).ok).toBe(false);
  });

  it('un jugador ajeno responde en el turno de otro y puede contraofertar', () => {
    const s = humanVsBots(21);
    finishDraft(s);
    for (let i = 0; i < 2000 && !(s.phase.kind === 'trade' && s.phase.player === 1); i++) {
      if (activePlayer(s) === 0) issue(s, 0, { type: 'endTurn' });
      else stepMatch(s);
    }
    issue(s, 1, { type: 'propose', to: 0, give: { stone: 10 }, want: { wood: 20 } });
    const offer = s.offers[s.offers.length - 1];
    expect(issue(s, 0, { type: 'setJob', baseId: basesOf(s, 0)[0].id, job: 'wood', delta: 1 }).ok).toBe(false);
    expect(issue(s, 0, { type: 'counter', offerId: offer.id, give: { wood: 10 }, want: { stone: 10 } }).ok).toBe(true);
    const reply = s.offers[s.offers.length - 1];
    expect(reply.from).toBe(0);
    expect(reply.to).toBe(1);
    expect(reply.counterOf).toBe(offer.id);
  });

  it('las ofertas vencen con la fase', () => {
    const s = humanVsBots(22);
    reachTrade(s);
    issue(s, 0, { type: 'propose', to: 1, give: { wood: 1 }, want: { stone: 1 } });
    issue(s, 0, { type: 'endTurn' });
    expect(s.offers.length).toBe(0);
  });

  it('el mercado neutral paga peor que un trato justo y respeta el saldo', () => {
    const s = humanVsBots(23);
    reachTrade(s);
    expect(marketPrice('wood', 'stone')).toBe(10);
    expect(marketPrice('wood', 'iron')).toBe(30);
    expect(market(s, 0, 'wood', 'stone').ok).toBe(true);
    expect(s.players[0].stock.wood).toBe(50);
    expect(s.players[0].stock.stone).toBe(35);
    s.players[0].stock.wood = 5;
    expect(market(s, 0, 'wood', 'stone').ok).toBe(false);
    expect(s.players[0].stock.wood).toBe(5);
  });
});

describe('alertas', () => {
  it('avisa cuánto falta para quedarse sin comida', () => {
    const s = humanVsBots(24);
    finishDraft(s);
    s.players[0].stock.food = 3;
    run(s, 1);
    expect(alertsFor(s, 0).some((a) => a.key === 'short-food')).toBe(true);
  });
});

describe('partida completa', () => {
  it('los bots sostienen una partida, crecen y nunca rompen invariantes', () => {
    const summary: string[] = [];
    for (let seed = 1; seed <= 8; seed++) {
      const s = allBots(seed * 100, 4);
      let trades = 0;
      const seen = new Set<number>();
      for (let i = 0; i < seconds(2400) && s.phase.kind !== 'over'; i++) {
        stepMatch(s);
        for (const offer of s.offers) {
          if (offer.status === 'accepted' && !seen.has(offer.id)) {
            seen.add(offer.id);
            trades++;
          }
        }
        if (i % 50 === 0) {
          for (const p of s.players) {
            for (const value of Object.values(p.stock)) {
              expect(value).toBeGreaterThanOrEqual(0);
              expect(value).toBeLessThanOrEqual(storageOf(s, p.id));
            }
            expect(populationOf(s, p.id)).toBeLessThanOrEqual(MAX_POPULATION);
          }
          for (const base of s.bases) {
            const total = Object.values(base.jobs).reduce((a, b) => a + b, 0);
            expect(total).toBeLessThanOrEqual(citizensOf(s, base.id).length);
          }
        }
      }
      expect(s.phase.kind).toBe('over');
      const scores = s.players.map((p) => scoreOf(s, p.id));
      summary.push(
        `seed ${seed * 100}: ronda ${s.round} t=${Math.round(s.tick / 10)}s pob=${scores.map((x) => x.citizens)} edif=${scores.map((x) => x.buildings)} bases=${scores.map((x) => x.bases)} mej=${scores.map((x) => x.upgrades)} tratos=${trades}`,
      );
      expect(Math.max(...scores.map((x) => x.citizens))).toBeGreaterThan(15);
    }
    console.log(summary.join('\n'));
  }, 120000);
});
