import Phaser from 'phaser';
import { BASE_RADIUS, WORLD_SIZE } from '../core/config';
import { deforestation } from '../core/ecology';
import { Terrain } from '../core/types';
import type { GameMap, GameState, Point, RegionEco } from '../core/types';
import { ART_SCALE } from './art';
import { MAP_HEIGHT, MAP_WIDTH, ellipseOf, toScreen } from './iso';

const pxScale = 1 / ART_SCALE;
const CLOUDS = 4;
const FLOCKS = 2;
const BIRDS = 5;
const GLINTS = 14;
const DUST = 9;
const DRY_TINT = 0xc9a35c;
const WITHERED = 0xd8c078;
/** Los lechos se pintan a menor resolución: agrandados quedan con borde suave. */
const BED_SCALE = 0.5;
const SHORE_RINGS = [2, 5];

interface Flock {
  birds: Phaser.GameObjects.Image[];
  x: number;
  y: number;
  goal: Point;
}

interface Beds {
  images: Phaser.GameObjects.Image[];
}

/** Lo que cambia con el ambiente y no pertenece a un nodo ni a un edificio. */
export class EcologyView {
  private blots = new Map<number, Phaser.GameObjects.Image>();
  private beds = new Map<number, Beds | null>();
  private cracks = new Map<number, Phaser.GameObjects.Image>();
  private rubble = new Map<number, Phaser.GameObjects.Image>();
  private withered = new Set<number>();
  private clouds: { sprite: Phaser.GameObjects.Image; speed: number }[] = [];
  private flocks: Flock[] = [];
  private glints: { sprite: Phaser.GameObjects.Image; phase: number; site: number }[] = [];

  constructor(
    private scene: Phaser.Scene,
    state: GameState,
    private tintRegion: (nodeIds: number[], tint: number) => void,
    private onCollapse: (owner: number) => void,
  ) {
    this.addClouds(state.map.seed);
    this.addBirds(state);
    this.addGlints(state.map);
  }

  private addClouds(seed: number) {
    for (let i = 0; i < CLOUDS; i++) {
      const spread = (seed * (i + 3) * 37) % 1000;
      const sprite = this.scene.add
        .image((MAP_WIDTH * ((i * 2 + 1) / (CLOUDS * 2))) | 0, (MAP_HEIGHT * (spread / 1000)) | 0, 'blot')
        .setTint(0x10202c)
        .setAlpha(0.13)
        .setScale(5 + (spread % 3), 2.4 + (spread % 2))
        .setDepth(95000);
      this.clouds.push({ sprite, speed: 5 + i * 1.5 });
    }
  }

  private addBirds(state: GameState) {
    for (let i = 0; i < FLOCKS; i++) {
      const start = toScreen(state.map.sites[i % state.map.sites.length].x, state.map.sites[i % state.map.sites.length].y);
      const birds = Array.from({ length: BIRDS }, () =>
        this.scene.add.image(start.x, start.y, 'bird').setScale(pxScale * 1.1).setDepth(95001).setAlpha(0.85),
      );
      this.flocks.push({ birds, x: start.x, y: start.y - 90, goal: start });
    }
  }

  private addGlints(map: GameMap) {
    const water: number[] = [];
    map.terrain.forEach((kind, i) => {
      if (kind === Terrain.Lake) water.push(i);
    });
    for (let i = 0; i < GLINTS && water.length > 0; i++) {
      const cell = water[(i * 7919 + map.seed * 31) % water.length];
      const x = ((cell % map.grid) + 0.5) * map.cell;
      const y = (Math.floor(cell / map.grid) + 0.5) * map.cell;
      const p = toScreen(x, y);
      const site = nearestSite(map, x, y);
      const sprite = this.scene.add.image(p.x, p.y, 'glint').setScale(pxScale).setDepth(-3).setAlpha(0);
      this.glints.push({ sprite, phase: i * 1.9, site });
    }
  }

  /** Lo que se mueve en cada cuadro. */
  frame(state: GameState, delta: number, time: number) {
    const seconds = delta / 1000;
    for (const cloud of this.clouds) {
      cloud.sprite.x += cloud.speed * seconds;
      if (cloud.sprite.x > MAP_WIDTH + 500) cloud.sprite.x = -500;
    }
    for (const glint of this.glints) {
      const wave = Math.sin(time * 0.0016 + glint.phase);
      glint.sprite.setAlpha(state.eco[glint.site].moisture < 0.6 ? 0 : Math.max(0, wave) * 0.8);
    }
    for (const flock of this.flocks) this.moveFlock(state, flock, seconds, time);
  }

  private moveFlock(state: GameState, flock: Flock, seconds: number, time: number) {
    const dx = flock.goal.x - flock.x;
    const dy = flock.goal.y - flock.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 30) {
      flock.goal = this.nextPerch(state, time);
      return;
    }
    const step = 38 * seconds;
    flock.x += (dx / distance) * step;
    flock.y += (dy / distance) * step;
    flock.birds.forEach((bird, i) => {
      const beat = Math.sin(time * 0.016 + i * 1.4);
      bird
        .setPosition(flock.x + ((i * 37) % 44) - 22, flock.y + ((i * 23) % 26) - 13)
        .setScale(pxScale * 1.1, pxScale * (0.55 + Math.abs(beat) * 0.6))
        .setFlipX(dx < 0);
    });
  }

  /** Las aves vuelan hacia donde todavía hay bosque: dejan las regiones taladas. */
  private nextPerch(state: GameState, time: number): Point {
    const woods = state.map.sites.filter((site) => state.eco[site.id].forest >= 0.5 && state.eco[site.id].trees >= 300);
    const site = woods[Math.floor(time / 977) % Math.max(1, woods.length)] ?? state.map.sites[0];
    const p = toScreen(site.x, site.y);
    return { x: p.x, y: p.y - 90 };
  }

  /** Lo que cambia despacio: se revisa unas veces por segundo. */
  sync(state: GameState, time: number) {
    state.eco.forEach((eco, id) => {
      this.syncLand(state, id, eco);
      this.syncBeds(state, id, eco);
      this.syncCrack(id, eco, time);
      this.syncRubble(state, id, eco);
    });
  }

  private syncLand(state: GameState, id: number, eco: RegionEco) {
    const alpha = Math.min(0.62, (1 - eco.moisture) * 0.8 + deforestation(eco) * 0.2);
    let blot = this.blots.get(id);
    if (!blot && alpha > 0.02) {
      const site = state.map.sites[id];
      const p = toScreen(site.x, site.y);
      const { rx, ry } = ellipseOf(BASE_RADIUS * 1.25);
      const size = this.scene.textures.get('blot').getSourceImage().width;
      blot = this.scene.add
        .image(p.x, p.y, 'blot')
        .setTint(DRY_TINT)
        .setScale((rx * 2) / size, (ry * 2) / size)
        .setDepth(-6);
      this.blots.set(id, blot);
    }
    blot?.setAlpha(alpha);

    const parched = eco.moisture < 0.45;
    if (parched !== this.withered.has(id)) {
      if (parched) this.withered.add(id);
      else this.withered.delete(id);
      this.tintRegion(state.map.sites[id].nodeIds, parched ? WITHERED : 0xffffff);
    }
  }

  /** Un lago que se achica: primero se ve el barro de la orilla y después el del centro. */
  private syncBeds(state: GameState, id: number, eco: RegionEco) {
    const dryness = Math.max(0, Math.min(1, (0.62 - eco.moisture) / 0.42));
    if (dryness <= 0 && !this.beds.has(id)) return;
    if (!this.beds.has(id)) this.beds.set(id, this.paintBeds(state.map, id));
    const beds = this.beds.get(id);
    if (!beds) return;
    beds.images[0]?.setAlpha(Math.min(1, dryness * 2));
    beds.images[1]?.setAlpha(Math.max(0, dryness * 2 - 1));
  }

  private paintBeds(map: GameMap, id: number): Beds | null {
    const site = map.sites[id];
    const reach = BASE_RADIUS * 1.2;
    const wet = (cx: number, cy: number) => {
      if (cx < 0 || cy < 0 || cx >= map.grid || cy >= map.grid) return false;
      const kind = map.terrain[cx + cy * map.grid];
      return kind === Terrain.Lake || kind === Terrain.River;
    };
    const { rx, ry } = ellipseOf(reach * 1.1);
    const center = toScreen(site.x, site.y);
    const left = center.x - rx;
    const top = center.y - ry;
    const makeLayer = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(rx * 2 * BED_SCALE);
      canvas.height = Math.ceil(ry * 2 * BED_SCALE);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#b4976b';
      return { canvas, ctx };
    };
    const layers = SHORE_RINGS.map(makeLayer);
    let painted = 0;
    const span = Math.ceil(reach / map.cell);
    const middleX = Math.floor(site.x / map.cell);
    const middleY = Math.floor(site.y / map.cell);
    for (let cy = middleY - span; cy <= middleY + span; cy++) {
      for (let cx = middleX - span; cx <= middleX + span; cx++) {
        if (!wet(cx, cy)) continue;
        const x = (cx + 0.5) * map.cell;
        const y = (cy + 0.5) * map.cell;
        if (Math.hypot(x - site.x, y - site.y) > reach || x < 0 || y < 0 || x > WORLD_SIZE || y > WORLD_SIZE) continue;
        const ring = distanceToLand(map, cx, cy, SHORE_RINGS[1]);
        const layer = ring <= SHORE_RINGS[0] ? layers[0] : layers[1];
        const p = toScreen(x, y);
        layer.ctx.beginPath();
        layer.ctx.ellipse((p.x - left) * BED_SCALE, (p.y - top) * BED_SCALE, 3.6, 2, 0, 0, Math.PI * 2);
        layer.ctx.fill();
        painted++;
      }
    }
    if (painted === 0) return null;
    const images = layers.map((layer, index) => {
      const key = `bed-${id}-${index}`;
      this.scene.textures.addCanvas(key, layer.canvas);
      return this.scene.add
        .image(center.x, center.y, key)
        .setScale(1 / BED_SCALE)
        .setDepth(-5)
        .setAlpha(0);
    });
    return { images };
  }

  private syncCrack(id: number, eco: RegionEco, time: number) {
    let mark = this.cracks.get(id);
    if (eco.crack && !mark) {
      const p = toScreen(eco.crack.x, eco.crack.y);
      mark = this.scene.add.image(p.x, p.y + 4, 'cracks').setScale(pxScale * 1.3).setDepth(p.y - 1);
      this.cracks.set(id, mark);
    }
    if (!eco.crack && mark) {
      mark.destroy();
      this.cracks.delete(id);
    }
    mark?.setAlpha(0.65 + Math.sin(time * 0.008) * 0.35);
  }

  private syncRubble(state: GameState, id: number, eco: RegionEco) {
    const pile = this.rubble.get(id);
    if (eco.rubble && !pile) {
      const p = toScreen(eco.rubble.x, eco.rubble.y);
      const image = this.scene.add.image(p.x, p.y, 'rubble').setOrigin(0.5, 0.8).setScale(pxScale * 1.6).setDepth(p.y + 2);
      this.rubble.set(id, image);
      this.scene.tweens.add({ targets: image, scale: { from: pxScale * 0.6, to: pxScale * 1.6 }, duration: 380, ease: 'Bounce.easeOut' });
      this.dust(p);
      const base = state.bases.find((b) => b.siteId === id);
      if (base) this.onCollapse(base.owner);
    }
    if (!eco.rubble && pile) {
      this.rubble.delete(id);
      this.scene.tweens.add({ targets: pile, alpha: 0, duration: 900, onComplete: () => pile.destroy() });
    }
  }

  private dust(p: Point) {
    for (let i = 0; i < DUST; i++) {
      const angle = (i / DUST) * Math.PI * 2;
      const puff = this.scene.add.image(p.x, p.y - 6, 'dust').setScale(pxScale).setDepth(p.y + 3).setAlpha(0.85);
      this.scene.tweens.add({
        targets: puff,
        x: p.x + Math.cos(angle) * 42,
        y: p.y - 6 + Math.sin(angle) * 20 - 12,
        scale: pxScale * 3,
        alpha: 0,
        duration: 1100 + (i % 3) * 200,
        ease: 'Quad.easeOut',
        onComplete: () => puff.destroy(),
      });
    }
  }
}

function nearestSite(map: GameMap, x: number, y: number) {
  return map.sites.reduce((best, site) => (Math.hypot(site.x - x, site.y - y) < Math.hypot(best.x - x, best.y - y) ? site : best)).id;
}

function distanceToLand(map: GameMap, cx: number, cy: number, limit: number) {
  for (let ring = 1; ring <= limit; ring++) {
    for (let d = -ring; d <= ring; d++) {
      for (const [x, y] of [[cx + d, cy - ring], [cx + d, cy + ring], [cx - ring, cy + d], [cx + ring, cy + d]]) {
        if (x < 0 || y < 0 || x >= map.grid || y >= map.grid) continue;
        if (map.terrain[x + y * map.grid] >= Terrain.Beach) return ring;
      }
    }
  }
  return limit + 1;
}
