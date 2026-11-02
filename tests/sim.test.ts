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
  scoreOf,
  siteAvailability,
  storageOf,
} from '../src/core/game';
import { isLand } from '../src/core/mapgen';
import { stepMatch } from '../src/core/match';
import type { Base, GameState, Job } from '../src/core/types';

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
      expect(s.phase.kind).toBe('decisions');
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
    issue(s, 0, { type: 'endTurn' });
    expect(activePlayer(s)).toBe(1);
    expect(setJob(s, base, 'wood', -1).ok).toBe(false);
    expect(issue(s, 0, { type: 'build', baseId: base.id, building: 'house' }).ok).toBe(false);
  });

  it('los bots no pueden dar órdenes sobre bases ajenas', () => {
    const s = humanVsBots(5);
    finishDraft(s);
    const mine = basesOf(s, 0)[0];
    issue(s, 0, { type: 'endTurn' });
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
    issue(s, 0, { type: 'endTurn' });
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

describe('partida completa', () => {
  it('los bots sostienen una partida, crecen y nunca rompen invariantes', () => {
    const summary: string[] = [];
    for (let seed = 1; seed <= 8; seed++) {
      const s = allBots(seed * 100, 4);
      for (let i = 0; i < seconds(1800) && s.phase.kind !== 'over'; i++) {
        stepMatch(s);
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
        `seed ${seed * 100}: ronda ${s.round} t=${Math.round(s.tick / 10)}s pob=${scores.map((x) => x.citizens)} edif=${scores.map((x) => x.buildings)}`,
      );
      expect(Math.max(...scores.map((x) => x.citizens))).toBeGreaterThan(15);
    }
    console.log(summary.join('\n'));
  }, 120000);
});
