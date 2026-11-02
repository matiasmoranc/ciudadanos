import { describe, expect, it } from 'vitest';
import { LOOT_MAX, TRUCE_ROUNDS, seconds } from '../src/core/config';
import { activePlayer, alertsFor, basesOf, bestSite, citizensOf, createGame, issue, populationOf } from '../src/core/game';
import { isLand } from '../src/core/mapgen';
import { stepMatch } from '../src/core/match';
import { findPath } from '../src/core/path';
import type { Building, GameState } from '../src/core/types';
import { etaOf, ringClosed, troopCount, wallPoint, wallSlots, wallsOf } from '../src/core/war';

const game = (seed: number, bots = 1) =>
  createGame(seed, [
    { name: 'Verde', color: 0x4caf50, isBot: false },
    ...Array.from({ length: bots }, (_, i) => ({ name: `Bot ${i}`, color: 0x2196f3, isBot: true })),
  ]);

function run(s: GameState, secs: number) {
  for (let i = 0; i < seconds(secs); i++) stepMatch(s);
}

function finishDraft(s: GameState) {
  for (let i = 0; i < 5000 && s.phase.kind === 'draft'; i++) {
    if (activePlayer(s) === 0) issue(s, 0, { type: 'pickSite', siteId: bestSite(s)!.id });
    else stepMatch(s);
  }
}

function armed(seed: number, soldiers = 10) {
  const s = game(seed);
  finishDraft(s);
  s.round = TRUCE_ROUNDS;
  const mine = basesOf(s, 0)[0];
  const enemy = s.bases.find((b) => b.owner === 1)!;
  mine.garrison.common = soldiers;
  return { s, mine, enemy };
}

const totalWood = (s: GameState) => s.players.reduce((sum, p) => sum + p.stock.wood, 0);

function placeNear(s: GameState, target: { x: number; y: number }, distance: number) {
  const army = s.armies[0];
  army.x = target.x + distance;
  army.y = target.y;
  army.path = [target];
  army.leg = 0;
  return army;
}

function barracks(s: GameState, baseId: number): Building {
  return {
    id: s.nextId++,
    type: 'barracks',
    baseId,
    owner: 0,
    x: 0,
    y: 0,
    done: true,
    progress: 1,
    required: 1,
    level: 1,
    upgrading: false,
    users: 0,
    slot: null,
    hp: 0,
  };
}

describe('ejército', () => {
  it('los soldados consumen ciudadanos, recursos y tiempo, y exigen cuartel', () => {
    const s = game(30);
    finishDraft(s);
    const base = basesOf(s, 0)[0];
    s.players[0].stock.iron = 20;
    expect(issue(s, 0, { type: 'train', baseId: base.id, kind: 'common' }).ok).toBe(false);
    s.buildings.push(barracks(s, base.id));
    const before = populationOf(s, 0);
    const people = citizensOf(s, base.id).length;
    expect(issue(s, 0, { type: 'train', baseId: base.id, kind: 'common' }).ok).toBe(true);
    expect(citizensOf(s, base.id).length).toBe(people - 1);
    expect(populationOf(s, 0)).toBe(before);
    expect(s.players[0].stock.iron).toBe(15);
    run(s, 16);
    expect(base.garrison.common).toBe(1);
    expect(populationOf(s, 0)).toBe(before);
  });

  it('hay tregua al principio', () => {
    const { s, mine, enemy } = armed(31);
    s.round = 1;
    const order = { kind: 'attack', baseId: enemy.id, mode: 'raid' } as const;
    expect(issue(s, 0, { type: 'sendArmy', baseId: mine.id, common: 5, heavy: 0, order }).ok).toBe(false);
  });

  it('el traslado llega solo, tarda según la distancia y suma a la guarnición', () => {
    const { s, mine } = armed(32);
    const other = basesOf(s, 0)[1];
    const order = { kind: 'move', baseId: other.id } as const;
    expect(issue(s, 0, { type: 'sendArmy', baseId: mine.id, common: 4, heavy: 0, order }).ok).toBe(true);
    expect(mine.garrison.common).toBe(6);
    const eta = etaOf(s.armies[0]);
    expect(eta).toBeGreaterThan(40);
    run(s, eta - 5);
    expect(s.armies.length).toBe(1);
    run(s, 10);
    expect(other.garrison.common).toBe(4);
  });

  it('avisa al jugador atacado con el tiempo de llegada, y hay margen para reaccionar', () => {
    const { s, enemy, mine } = armed(33);
    enemy.garrison.common = 10;
    s.phase = { kind: 'decisions', player: 1, endsAt: s.tick + 300, botActAt: s.tick + 300 };
    const order = { kind: 'attack', baseId: mine.id, mode: 'conquer' } as const;
    expect(issue(s, 1, { type: 'sendArmy', baseId: enemy.id, common: 10, heavy: 0, order }).ok).toBe(true);
    const alert = alertsFor(s, 0).find((a) => a.armyId !== undefined);
    expect(alert?.text).toContain('llega en');
    expect(etaOf(s.armies[0])).toBeGreaterThanOrEqual(45);
    expect(s.events.some((e) => e.player === 0 && e.text.includes('envió 10 soldados'))).toBe(true);
  });

  it('los ejércitos enemigos se cruzan y pelean hasta que queda uno', () => {
    const { s, mine, enemy } = armed(34, 12);
    s.phase = { kind: 'decisions', player: 0, endsAt: s.tick + 3000, botActAt: s.tick + 3000 };
    const spot = { x: enemy.x + 60, y: enemy.y };
    issue(s, 0, { type: 'sendArmy', baseId: mine.id, common: 12, heavy: 0, order: { kind: 'hold', ...spot } });
    const mineArmy = placeNear(s, spot, 0);
    s.armies.push({ ...mineArmy, id: s.nextId++, owner: 1, common: 3, x: spot.x + 10 });
    run(s, 30);
    expect(s.armies.some((a) => a.owner === 1)).toBe(false);
    const survivors = s.armies.filter((a) => a.owner === 0);
    expect(survivors.length).toBe(1);
    expect(troopCount(survivors[0])).toBeLessThanOrEqual(12);
  });

  it('el saqueo roba con límite, sin negativos ni duplicar', () => {
    const { s, mine, enemy } = armed(35);
    s.phase = { kind: 'decisions', player: 0, endsAt: s.tick + 3000, botActAt: s.tick + 3000 };
    Object.assign(s.players[1].stock, { wood: 1000, gold: 3 });
    const order = { kind: 'attack', baseId: enemy.id, mode: 'raid' } as const;
    issue(s, 0, { type: 'sendArmy', baseId: mine.id, common: 10, heavy: 0, order });
    const army = placeNear(s, enemy, 30);
    s.players[0].stock.wood = 0;
    const total = totalWood(s);
    run(s, 20);
    expect(s.players[0].stock.wood).toBeGreaterThan(0);
    expect(s.players[0].stock.wood).toBeLessThanOrEqual(LOOT_MAX);
    expect(s.players[1].stock.wood).toBeGreaterThan(900);
    expect(s.players[1].stock.gold).toBeGreaterThanOrEqual(0);
    expect(totalWood(s)).toBeLessThanOrEqual(total);
    expect(army.order.kind).toBe('retreat');
  });

  it('conquista una base sin defensa y pasa ciudadanos y edificios al ganador', () => {
    const { s, mine, enemy } = armed(36);
    s.phase = { kind: 'decisions', player: 0, endsAt: s.tick + 3000, botActAt: s.tick + 3000 };
    const order = { kind: 'attack', baseId: enemy.id, mode: 'conquer' } as const;
    issue(s, 0, { type: 'sendArmy', baseId: mine.id, common: 10, heavy: 0, order });
    placeNear(s, enemy, 30);
    const people = citizensOf(s, enemy.id).length;
    run(s, 36);
    expect(enemy.owner).toBe(0);
    expect(citizensOf(s, enemy.id).every((c) => c.owner === 0)).toBe(true);
    expect(citizensOf(s, enemy.id).length).toBe(people);
    expect(enemy.garrison.common).toBe(10);
  });

  it('un anillo completo frena el paso hasta romper un tramo; con un hueco no frena', () => {
    const { s, mine, enemy } = armed(37);
    s.phase = { kind: 'decisions', player: 0, endsAt: s.tick + 3000, botActAt: s.tick + 3000 };
    for (const slot of wallSlots(s, enemy)) {
      s.buildings.push({
        id: s.nextId++,
        type: 'wallWood',
        baseId: enemy.id,
        owner: 1,
        ...wallPoint(enemy, slot),
        progress: 1,
        required: 1,
        done: true,
        level: 1,
        upgrading: false,
        users: 0,
        slot,
        hp: 400,
      });
    }
    expect(ringClosed(s, enemy)).toBe(true);
    const order = { kind: 'attack', baseId: enemy.id, mode: 'raid' } as const;
    issue(s, 0, { type: 'sendArmy', baseId: mine.id, common: 10, heavy: 0, order });
    const army = placeNear(s, enemy, 150);
    run(s, 6);
    expect(Math.hypot(army.x - enemy.x, army.y - enemy.y)).toBeGreaterThan(115);
    expect(army.sieging).toBe(true);
    const before = wallsOf(s, enemy).length;
    run(s, 8);
    expect(wallsOf(s, enemy).length).toBeLessThan(before);
    expect(ringClosed(s, enemy)).toBe(false);
  });

  it('los defensores salen solos según la postura', () => {
    const { s, mine } = armed(38);
    mine.garrison.common = 8;
    mine.stance = 'aggressive';
    const spots = Array.from({ length: 12 }, (_, i) => ({
      x: mine.x + Math.cos((i / 12) * Math.PI * 2) * 200,
      y: mine.y + Math.sin((i / 12) * Math.PI * 2) * 200,
    }));
    const spot = spots.find((p) => isLand(s.map, p.x, p.y) && findPath(s.map, mine, p))!;
    s.armies.push({
      id: s.nextId++,
      owner: 1,
      common: 2,
      heavy: 0,
      ...spot,
      wounds: 0,
      order: { kind: 'hold', ...spot },
      path: [spot],
      leg: 1,
      fighting: false,
      sieging: false,
      progress: 0,
      home: null,
    });
    run(s, 2);
    expect(mine.garrison.common).toBe(0);
    expect(s.armies.some((a) => a.owner === 0 && a.home === mine.id)).toBe(true);
  });

  it('una expedición puede ser interceptada', () => {
    const { s, mine } = armed(39);
    s.expeditions.push({ id: s.nextId++, owner: 1, siteId: 0, settlers: 3, path: [mine, mine], leg: 1, x: mine.x, y: mine.y });
    const spot = { x: mine.x + 5, y: mine.y };
    s.armies.push({
      id: s.nextId++,
      owner: 0,
      common: 3,
      heavy: 0,
      ...spot,
      wounds: 0,
      order: { kind: 'hold', ...spot },
      path: [spot],
      leg: 1,
      fighting: false,
      sieging: false,
      progress: 0,
      home: null,
    });
    run(s, 1);
    expect(s.expeditions.length).toBe(0);
  });

  it('los bots pelean en una partida al ritmo de una persona', () => {
    const s = game(40, 3);
    finishDraft(s);
    for (const base of basesOf(s, 0)) {
      issue(s, 0, { type: 'setJob', baseId: base.id, job: base === basesOf(s, 0)[0] ? 'food' : 'water', delta: 2 });
    }
    let attacks = 0;
    const seen = new Set<number>();
    for (let i = 0; i < seconds(2700) && s.phase.kind !== 'over'; i++) {
      const phase = s.phase;
      if ((phase.kind === 'decisions' || phase.kind === 'trade') && phase.player === 0 && phase.endsAt - s.tick < 100) {
        issue(s, 0, { type: 'endTurn' });
      }
      stepMatch(s);
      for (const army of s.armies) {
        if (!seen.has(army.id)) {
          seen.add(army.id);
          if (army.order.kind === 'attack') attacks++;
        }
      }
    }
    console.log('ataques entre bots:', attacks, 'ronda', s.round);
    expect(attacks).toBeGreaterThan(0);
  }, 120000);
});
