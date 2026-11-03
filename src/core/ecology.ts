import {
  BUSH_GROWTH_SECONDS,
  BUSH_REGROW_SECONDS,
  COLLAPSE_DEATHS,
  COLLAPSE_RADIUS,
  CRACK_SECONDS,
  DROUGHT_END,
  DROUGHT_START,
  DRYING_LEVEL,
  ECO_STEP_SECONDS,
  FOREST_BARE,
  FOREST_THIN,
  MINING_JOBS,
  MIN_FOREST_WOOD,
  MOISTURE_DOWN_SECONDS,
  MOISTURE_UP_SECONDS,
  REGROW_SECONDS,
  RUBBLE_SECONDS,
  SAFE_MINERS,
  SAPLING_SECONDS,
  SOIL_MIN,
  SOIL_REST_SECONDS,
  SOIL_TIRED,
  SOIL_TIRE_SECONDS,
  STRAIN_AFTER,
  STRAIN_DECAY_PER_MIN,
  STRAIN_LIMIT,
  THIRST_BASE,
  THIRST_MAX,
  THIRST_PER_SHORE,
  UNSTABLE_BIOMES,
  WORKSITE_SLOTS,
  seconds,
} from './config';
import { citizensOf, random, refreshBase, say, warn } from './game';
import type { Base, Building, GameState, Job, Point, RegionEco, ResourceNode } from './types';

const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const STEP = ECO_STEP_SECONDS;
const MINING_NODES = ['rock', 'iron', 'gold'];

export function createEco(s: GameState): RegionEco[] {
  const { sites } = s.map;
  const closest = (node: ResourceNode) =>
    sites.reduce((best, site) => (Math.hypot(site.x - node.x, site.y - node.y) < Math.hypot(best.x - node.x, best.y - node.y) ? site : best));
  return sites.map((site) => ({
    trees: site.nodeIds.reduce((sum, id) => sum + (s.nodes[id].kind === 'tree' ? s.nodes[id].max : 0), 0),
    own: site.nodeIds.filter((id) => closest(s.nodes[id]) === site),
    forest: 1,
    moisture: 1,
    drought: false,
    thirst: 0,
    drawn: 0,
    regrow: 0,
    bushes: 0,
    strain: 0,
    crack: null,
    crackAt: 0,
    crackTurn: false,
    rubble: null,
  }));
}

export const isUnstable = (s: GameState, base: Base) => UNSTABLE_BIOMES.includes(s.map.sites[base.siteId].biome);

/** Cuánto daño hizo la tala a la región: 0 hasta perder la mitad, 1 con el bosque casi pelado. */
export function deforestation(eco: RegionEco): number {
  if (eco.trees < MIN_FOREST_WOOD) return 0;
  return clamp((FOREST_THIN - eco.forest) / (FOREST_THIN - FOREST_BARE));
}

/** Rinde de cultivos y agua según la humedad: pleno por encima de 0,6. */
export const moistureYield = (eco: RegionEco) => clamp(0.4 + eco.moisture, 0.5, 1);

/** Hasta dónde se recupera la tierra: un bosque talado deja suelos más pobres. */
export const soilCap = (eco: RegionEco) => 1 - deforestation(eco) * 0.3;

export function yieldFactor(s: GameState, base: Base, job: Job, farm?: Building): number {
  const eco = s.eco[base.siteId];
  if (job === 'water') return moistureYield(eco);
  if (job === 'food' && farm) return farm.soil * moistureYield(eco);
  return 1;
}

/** Cada unidad extraída suma: agua a la sed de la región y piedra o metal a la tensión del terreno. */
export function noteExtraction(s: GameState, base: Base, job: Job) {
  const eco = s.eco[base.siteId];
  if (job === 'water') eco.drawn++;
  else if (MINING_JOBS.includes(job) && isUnstable(s, base)) eco.strain++;
}

/** Nadie sufre un derrumbe sin haber tenido un turno para evitarlo. */
export function noteTurn(s: GameState, player: number) {
  for (const base of s.bases) {
    if (base.owner === player && s.eco[base.siteId].crack) s.eco[base.siteId].crackTurn = true;
  }
}

export function stepEcology(s: GameState) {
  if (s.tick % seconds(STEP) !== 0) return;
  for (const node of s.nodes) stepNode(s, node);
  s.eco.forEach((eco, id) => {
    const base = s.bases.find((b) => b.siteId === id);
    updateForest(s, id, eco);
    stepRegrowth(s, id, eco);
    stepMoisture(s, id, eco, base);
    if (base) stepGround(s, id, eco, base);
    if (eco.rubble && s.tick >= eco.rubble.until) {
      eco.rubble = null;
      if (base) say(s, base.owner, `Se despejó el derrumbe en ${base.name}.`, 'good');
    }
  });
  stepSoil(s);
}

function stepNode(s: GameState, node: ResourceNode) {
  if (node.closed === 'rubble' && s.tick >= node.reopenAt) node.closed = null;
  if (node.growth <= 0) return;
  node.growth += STEP / (node.kind === 'tree' ? SAPLING_SECONDS : BUSH_GROWTH_SECONDS);
  if (node.growth >= 1) {
    node.growth = 0;
    node.amount = node.max;
  }
}

function updateForest(s: GameState, id: number, eco: RegionEco) {
  if (eco.trees === 0) return;
  let left = 0;
  for (const nodeId of s.map.sites[id].nodeIds) {
    const node = s.nodes[nodeId];
    if (node.kind === 'tree') left += node.amount + node.growth * node.max;
  }
  eco.forest = left / eco.trees;
}

const regrowSeconds = (eco: RegionEco) =>
  eco.forest >= FOREST_THIN
    ? REGROW_SECONDS.healthy
    : eco.forest >= FOREST_BARE
      ? REGROW_SECONDS.thin
      : REGROW_SECONDS.bare;

function freeGround(s: GameState, node: ResourceNode) {
  return !s.buildings.some((b) => Math.hypot(b.x - node.x, b.y - node.y) < 18);
}

/** Vuelven de a uno, primero al lado de lo que sigue en pie: el bosque crece desde su borde. */
function sprout(s: GameState, id: number, kind: ResourceNode['kind']) {
  const nodes = s.eco[id].own.map((nodeId) => s.nodes[nodeId]).filter((n) => n.kind === kind);
  const empty = nodes.filter((n) => n.amount === 0 && n.growth === 0 && freeGround(s, n));
  if (empty.length === 0) return false;
  const alive = nodes.filter((n) => n.amount > 0 || n.growth > 0);
  const near = (n: ResourceNode) => alive.reduce((best, o) => Math.min(best, Math.hypot(o.x - n.x, o.y - n.y)), Infinity);
  const pick = alive.length
    ? empty.reduce((best, n) => (near(n) < near(best) ? n : best))
    : empty[Math.floor(random(s) * empty.length)];
  pick.growth = STEP / (kind === 'tree' ? SAPLING_SECONDS : BUSH_GROWTH_SECONDS);
  return true;
}

function stepRegrowth(s: GameState, id: number, eco: RegionEco) {
  eco.regrow += STEP / regrowSeconds(eco);
  if (eco.regrow >= 1) eco.regrow = sprout(s, id, 'tree') ? eco.regrow - 1 : 1;
  eco.bushes += (STEP / BUSH_REGROW_SECONDS) * soilCap(eco) * moistureYield(eco);
  if (eco.bushes >= 1) eco.bushes = sprout(s, id, 'bush') ? eco.bushes - 1 : 1;
}

function shoresOf(s: GameState, id: number) {
  return s.map.sites[id].nodeIds.map((nodeId) => s.nodes[nodeId]).filter((n) => n.kind === 'water');
}

/** Se seca la mitad de las orillas, pero siempre queda alguna. */
function setShores(s: GameState, id: number, dry: boolean) {
  const shores = shoresOf(s, id);
  shores.forEach((node, index) => {
    if (dry && index % 2 === 1) node.closed = 'dry';
    if (!dry && node.closed === 'dry') node.closed = null;
  });
}

function stepMoisture(s: GameState, id: number, eco: RegionEco, base: Base | undefined) {
  const perMinute = (eco.drawn * 60) / STEP;
  eco.drawn = 0;
  eco.thirst = eco.thirst * 0.8 + perMinute * 0.2;
  const limit = Math.min(THIRST_MAX, THIRST_BASE + shoresOf(s, id).length * THIRST_PER_SHORE);
  const overdrawn = clamp((eco.thirst - limit) / limit);
  const cleared = deforestation(eco);
  const target = clamp(1 - (cleared + overdrawn) * 0.8);
  const before = eco.moisture;
  eco.moisture += clamp(target - before, -STEP / MOISTURE_DOWN_SECONDS, STEP / MOISTURE_UP_SECONDS);

  if (!eco.drought && eco.moisture < DROUGHT_START) {
    eco.drought = true;
    setShores(s, id, true);
    if (base) say(s, base.owner, `¡Sequía en ${base.name}! Rinden menos los cultivos y el agua, y se secan orillas.`, 'bad');
  } else if (eco.drought && eco.moisture > DROUGHT_END) {
    eco.drought = false;
    setShores(s, id, false);
    if (base) say(s, base.owner, `Terminó la sequía en ${base.name}.`, 'good');
  } else if (base && !eco.drought && eco.moisture < DRYING_LEVEL && target < before) {
    const cause = cleared >= overdrawn ? 'Se taló demasiado bosque' : 'Se extrae demasiada agua';
    warn(s, `drying:${id}`, base.owner, `${base.name} se está secando. ${cause}.`, 'warn', 180);
  }
}

function stepGround(s: GameState, id: number, eco: RegionEco, base: Base) {
  if (!isUnstable(s, base)) return;
  eco.strain = Math.max(0, eco.strain - (STRAIN_DECAY_PER_MIN * STEP) / 60);
  const miners = MINING_JOBS.reduce((sum, job) => sum + base.effective[job], 0);
  if (!eco.crack) {
    if (eco.strain < STRAIN_LIMIT || miners <= SAFE_MINERS) return;
    eco.crack = crackPoint(s, id);
    if (!eco.crack) return;
    eco.crackAt = s.tick + seconds(CRACK_SECONDS);
    eco.crackTurn = false;
    say(s, base.owner, `¡Grietas en ${base.name}! Dejá ${SAFE_MINERS} o menos en piedra, hierro y oro, o habrá un derrumbe.`, 'bad');
    return;
  }
  if (miners <= SAFE_MINERS) {
    eco.crack = null;
    eco.strain = STRAIN_AFTER;
    say(s, base.owner, `El terreno de ${base.name} se asentó.`, 'good');
  } else if (s.tick >= eco.crackAt && eco.crackTurn) {
    collapse(s, id, eco, base);
  }
}

function crackPoint(s: GameState, id: number): Point | null {
  const veins = s.map.sites[id].nodeIds
    .map((nodeId) => s.nodes[nodeId])
    .filter((n) => MINING_NODES.includes(n.kind) && n.amount > 0 && n.closed === null);
  const busiest = veins.reduce<ResourceNode | null>((best, n) => (!best || n.users > best.users ? n : best), null);
  return busiest && { x: busiest.x, y: busiest.y };
}

function collapse(s: GameState, id: number, eco: RegionEco, base: Base) {
  const center = eco.crack!;
  const buried = new Set<number>();
  for (const nodeId of s.map.sites[id].nodeIds) {
    const node = s.nodes[nodeId];
    if (!MINING_NODES.includes(node.kind) || Math.hypot(node.x - center.x, node.y - center.y) > COLLAPSE_RADIUS) continue;
    node.closed = 'rubble';
    node.reopenAt = s.tick + seconds(RUBBLE_SECONDS);
    buried.add(nodeId);
  }
  const people = citizensOf(s, base.id);
  const victims = people
    .filter((c) => c.target?.kind === 'node' && buried.has(c.target.id))
    .sort((a, b) => Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y))
    .slice(0, Math.min(COLLAPSE_DEATHS, people.length - 1));
  s.citizens = s.citizens.filter((c) => !victims.includes(c));
  refreshBase(s, base);
  eco.rubble = { ...center, until: s.tick + seconds(RUBBLE_SECONDS) };
  eco.crack = null;
  eco.strain = STRAIN_AFTER;
  const loss = victims.length === 0 ? 'No hubo víctimas' : victims.length === 1 ? 'Murió 1 trabajador' : `Murieron ${victims.length} trabajadores`;
  say(s, base.owner, `¡Derrumbe en ${base.name}! ${loss} y la zona queda bloqueada 2 minutos.`, 'bad');
}

/** Con 3 trabajadores la tierra se cansa, con 2 se mantiene y con menos descansa. */
function stepSoil(s: GameState) {
  for (const farm of s.buildings) {
    if (farm.type !== 'farm' || !farm.done) continue;
    const base = s.bases.find((b) => b.id === farm.baseId);
    if (!base) continue;
    const span = 1 - SOIL_MIN;
    const change =
      farm.users >= WORKSITE_SLOTS
        ? -span / SOIL_TIRE_SECONDS
        : farm.users === WORKSITE_SLOTS - 1
          ? 0
          : farm.users === 1
            ? span / SOIL_TIRE_SECONDS
            : span / SOIL_REST_SECONDS;
    const before = farm.soil;
    farm.soil = clamp(farm.soil + change * STEP, SOIL_MIN, soilCap(s.eco[base.siteId]));
    if (before >= SOIL_TIRED && farm.soil < SOIL_TIRED) {
      warn(s, `soil:${base.id}`, base.owner, `La tierra de ${base.name} está cansada. Con menos de ${WORKSITE_SLOTS} por granja descansa.`, 'warn', 150);
    }
  }
}

export interface LandMeter {
  icon: string;
  name: string;
  value: string;
  ratio: number;
  tone: 'good' | 'warn' | 'bad';
}

export interface LandNote {
  text: string;
  tone: '' | 'good' | 'bad';
}

const percent = (ratio: number) => `${Math.round(ratio * 100)} %`;
const toneOf = (ratio: number, warnAt: number, badAt: number) =>
  ratio < badAt ? 'bad' : ratio < warnAt ? 'warn' : 'good';

export const farmsOf = (s: GameState, base: Base) =>
  s.buildings.filter((b) => b.baseId === base.id && b.type === 'farm' && b.done);

/** Lo que el jugador necesita saber de su región, en sus palabras. */
export function landStatus(s: GameState, base: Base) {
  const eco = s.eco[base.siteId];
  const farms = farmsOf(s, base);
  const soil = farms.length ? farms.reduce((sum, f) => sum + f.soil, 0) / farms.length : soilCap(eco);
  const wooded = eco.trees >= MIN_FOREST_WOOD;
  const unstable = isUnstable(s, base);
  const strain = clamp(eco.strain / STRAIN_LIMIT);
  const meters: LandMeter[] = [
    {
      icon: '🌲',
      name: 'Bosque',
      value: wooded ? percent(eco.forest) : 'Casi sin árboles',
      ratio: wooded ? eco.forest : 0,
      tone: wooded ? toneOf(eco.forest, FOREST_THIN, FOREST_BARE) : 'warn',
    },
    { icon: '💧', name: 'Humedad', value: percent(eco.moisture), ratio: eco.moisture, tone: toneOf(eco.moisture, DRYING_LEVEL, DROUGHT_START) },
    { icon: '🌱', name: 'Tierra', value: percent(soil), ratio: soil, tone: toneOf(soil, SOIL_TIRED, 0.55) },
    {
      icon: '⛰️',
      name: 'Terreno',
      value: unstable ? `Tensión ${percent(strain)}` : 'Firme',
      ratio: unstable ? 1 - strain : 1,
      tone: unstable ? toneOf(1 - strain, 0.5, 0.15) : 'good',
    },
  ];

  const notes: LandNote[] = [];
  if (eco.crack) notes.push({ text: `Hay grietas: dejá ${SAFE_MINERS} o menos en piedra, hierro y oro para evitar el derrumbe.`, tone: 'bad' });
  if (eco.rubble) notes.push({ text: 'Derrumbe: las vetas de esa zona están bloqueadas por unos minutos.', tone: 'bad' });
  if (eco.drought) {
    notes.push({ text: `Sequía: cultivos y agua rinden ${percent(moistureYield(eco))} y se secó parte de las orillas.`, tone: 'bad' });
  } else if (eco.moisture < DRYING_LEVEL) {
    notes.push({ text: 'La región se está secando. Extraé menos agua aquí o dejá crecer el bosque.', tone: 'bad' });
  }
  if (deforestation(eco) > 0) {
    notes.push({ text: 'Poco bosque: los árboles vuelven más lento, la tierra rinde menos y la región se reseca.', tone: 'bad' });
  } else if (wooded) {
    notes.push({ text: `Conservá más del ${percent(FOREST_THIN)} del bosque y seguirá creciendo a buen ritmo.`, tone: '' });
  }
  if (farms.length > 0) {
    const tired = farms.some((f) => f.soil < SOIL_TIRED);
    notes.push({
      text: tired
        ? `Tierra cansada: con menos de ${WORKSITE_SLOTS} por granja se recupera.`
        : `Con ${WORKSITE_SLOTS} por granja la tierra se cansa; con 2 se mantiene.`,
      tone: tired ? 'bad' : '',
    });
  }
  if (unstable && !eco.crack) {
    notes.push({ text: `Zona inestable: con más de ${SAFE_MINERS} picando puede haber un derrumbe, siempre con aviso.`, tone: '' });
  }
  return { meters, notes };
}

/** Lo que vale la pena saber antes de fundar en una región ya usada. */
export function siteWarnings(eco: RegionEco): string[] {
  const warnings: string[] = [];
  if (eco.drought) warnings.push('Hoy sufre una sequía.');
  if (deforestation(eco) > 0) warnings.push(`Queda ${percent(eco.forest)} de su bosque.`);
  return warnings;
}
