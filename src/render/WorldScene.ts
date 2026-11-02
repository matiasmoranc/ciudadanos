import Phaser from 'phaser';
import { BASE_RADIUS, TICKS_PER_SECOND } from '../core/config';
import { capacityOf, citizensOf, needsWork, siteAvailability } from '../core/game';
import { stepMatch } from '../core/match';
import type { Base, Building, Citizen, GameState, ResourceNode } from '../core/types';
import { ART_SCALE, buildingKey, citizenKey, createArt } from './art';
import { MAP_HEIGHT, MAP_WIDTH, ellipseOf, toScreen } from './iso';
import { paintTerrain } from './terrain';

export interface SceneHost {
  state: GameState;
  speed: number;
  selection(): { baseId: number | null; siteId: number | null; picking: boolean };
  onTapBase(id: number): void;
  onTapSite(id: number): void;
  onTapEmpty(): void;
  onFrame(): void;
}

const STEP_MS = 1000 / TICKS_PER_SECOND;
const TAP_SLOP = 10;
const LABEL_FONT = 30;
const LABEL_SIZE = 12;
const pxScale = 1 / ART_SCALE;

interface CitizenView {
  sprite: Phaser.GameObjects.Image;
  x: number;
  y: number;
  job: Citizen['job'];
}

interface BuildingView {
  sprite: Phaser.GameObjects.Image;
  flag?: Phaser.GameObjects.Image;
  bar: Phaser.GameObjects.Graphics;
  star?: Phaser.GameObjects.Image;
  done: boolean;
}

interface ExpeditionView {
  sprites: Phaser.GameObjects.Image[];
  x: number;
  y: number;
}

interface BaseView {
  hall: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
}

export class WorldScene extends Phaser.Scene {
  private host!: SceneHost;
  private accumulator = 0;
  private lastSync = 0;
  private dpr = 1;

  private nodeViews = new Map<number, Phaser.GameObjects.Image>();
  private citizenViews = new Map<number, CitizenView>();
  private buildingViews = new Map<number, BuildingView>();
  private baseViews = new Map<number, BaseView>();
  private expeditionViews = new Map<number, ExpeditionView>();
  private siteMarks = new Map<number, Phaser.GameObjects.Graphics>();
  private influence!: Phaser.GameObjects.Graphics;

  private pinchDistance = 0;
  private dragged = 0;
  private lastPointer: { x: number; y: number } | null = null;
  private focused = false;

  constructor() {
    super('world');
  }

  init(data: { host: SceneHost; dpr: number }) {
    this.host = data.host;
    this.dpr = data.dpr;
  }

  create() {
    const state = this.host.state;
    this.textures.addCanvas('terrain', paintTerrain(state.map));
    this.add.image(0, 0, 'terrain').setOrigin(0).setDepth(-10);
    createArt(this, state.players.map((p) => p.color));

    this.influence = this.add.graphics().setDepth(90001);
    for (const peak of state.map.peaks) {
      const p = toScreen(peak.x, peak.y);
      this.add.image(p.x, p.y, 'peak').setOrigin(0.5, 0.92).setScale(pxScale * 3 * peak.size * 0.42).setDepth(p.y);
    }
    for (const node of state.nodes) this.addNode(node);
    for (const site of state.map.sites) {
      const p = toScreen(site.x, site.y);
      this.siteMarks.set(site.id, this.add.graphics({ x: p.x, y: p.y }).setDepth(-4));
    }

    this.setupCamera();
    this.setupInput();
    this.scale.on('resize', () => this.fitLimits());
  }

  private addNode(node: ResourceNode) {
    if (node.kind === 'water') return;
    const p = toScreen(node.x, node.y);
    const variety = (node.id * 7) % 10;
    const key = node.kind === 'tree' ? (variety < 5 ? 'tree-pine' : 'tree-round') : node.kind;
    const size = node.kind === 'tree' ? 0.95 + (variety / 10) * 0.45 : 0.85 + (variety / 10) * 0.35;
    const sprite = this.add
      .image(p.x, p.y, key)
      .setOrigin(0.5, 0.88)
      .setScale(pxScale * size)
      .setDepth(p.y);
    sprite.setData('size', size);
    this.nodeViews.set(node.id, sprite);
  }

  private minZoom() {
    const cam = this.cameras.main;
    return Math.max(cam.width / MAP_WIDTH, cam.height / MAP_HEIGHT);
  }

  private fitLimits() {
    const cam = this.cameras.main;
    cam.setZoom(Phaser.Math.Clamp(cam.zoom, this.minZoom(), 3.2 * this.dpr));
  }

  private setupCamera() {
    const cam = this.cameras.main;
    cam.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);
    cam.setBackgroundColor('#2f86b3');
    // La isla ocupa el centro del lienzo: arranca encuadrada, sin tanto mar.
    cam.setZoom(Math.max(this.minZoom(), Math.min(cam.width / 1280, cam.height / 760)));
    cam.centerOn(MAP_WIDTH / 2, MAP_HEIGHT / 2);
  }

  private zoomAt(next: number, screenX: number, screenY: number) {
    const cam = this.cameras.main;
    const before = cam.getWorldPoint(screenX, screenY);
    cam.setZoom(Phaser.Math.Clamp(next, this.minZoom(), 3.2 * this.dpr));
    const after = cam.getWorldPoint(screenX, screenY);
    cam.scrollX += before.x - after.x;
    cam.scrollY += before.y - after.y;
  }

  private setupInput() {
    this.input.addPointer(1);

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.dragged = 0;
      this.lastPointer = { x: pointer.x, y: pointer.y };
      this.pinchDistance = 0;
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const a = this.input.pointer1;
      const b = this.input.pointer2;
      if (a.isDown && b.isDown) {
        const distance = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
        if (this.pinchDistance > 0) {
          const cam = this.cameras.main;
          this.zoomAt(cam.zoom * (distance / this.pinchDistance), (a.x + b.x) / 2, (a.y + b.y) / 2);
        }
        this.pinchDistance = distance;
        this.dragged = TAP_SLOP + 1;
        return;
      }
      if (!pointer.isDown || !this.lastPointer) return;
      const dx = pointer.x - this.lastPointer.x;
      const dy = pointer.y - this.lastPointer.y;
      this.dragged += Math.abs(dx) + Math.abs(dy);
      this.lastPointer = { x: pointer.x, y: pointer.y };
      if (this.dragged <= TAP_SLOP) return;
      const cam = this.cameras.main;
      cam.scrollX -= dx / cam.zoom;
      cam.scrollY -= dy / cam.zoom;
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      this.pinchDistance = 0;
      if (this.dragged <= TAP_SLOP) this.tap(pointer.worldX, pointer.worldY);
    });

    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      this.zoomAt(cam.zoom * (dy > 0 ? 0.88 : 1.14), pointer.x, pointer.y);
    });
  }

  private tap(worldX: number, worldY: number) {
    const state = this.host.state;
    const reach = 46;
    const distanceTo = (x: number, y: number) => {
      const p = toScreen(x, y);
      return Math.hypot(p.x - worldX, (p.y - 14 - worldY) * 1.2);
    };
    if (state.phase.kind === 'draft' || this.host.selection().picking) {
      let best = -1;
      let bestDistance = reach;
      for (const site of state.map.sites) {
        const d = distanceTo(site.x, site.y);
        if (d < bestDistance) {
          bestDistance = d;
          best = site.id;
        }
      }
      if (best >= 0) this.host.onTapSite(best);
      else this.host.onTapEmpty();
      return;
    }
    let hit: Base | null = null;
    let hitDistance = reach;
    for (const base of state.bases) {
      const d = distanceTo(base.x, base.y);
      if (d < hitDistance) {
        hitDistance = d;
        hit = base;
      }
    }
    if (hit) this.host.onTapBase(hit.id);
    else this.host.onTapEmpty();
  }

  focusOn(x: number, y: number) {
    const p = toScreen(x, y);
    const cam = this.cameras.main;
    this.tweens.add({
      targets: cam,
      zoom: Math.max(this.minZoom(), 1.05 * this.dpr),
      scrollX: p.x - cam.width / 2,
      scrollY: p.y - cam.height / 2,
      duration: 700,
      ease: 'Sine.easeInOut',
    });
  }

  update(_time: number, delta: number) {
    const state = this.host.state;
    this.accumulator += Math.min(delta, 250) * this.host.speed;
    while (this.accumulator >= STEP_MS) {
      this.accumulator -= STEP_MS;
      stepMatch(state);
    }

    const time = this.time.now;
    this.syncCitizens(state, delta, time);
    this.syncExpeditions(state, delta, time);
    if (time - this.lastSync > 120) {
      this.lastSync = time;
      this.syncNodes(state, time);
      this.syncBases(state);
      this.syncBuildings(state, time);
      this.syncSiteMarks(state, time);
      this.drawInfluence(state);
      if (!this.focused && state.phase.kind !== 'draft') {
        this.focused = true;
        const mine = state.bases.find((b) => b.owner === 0);
        if (mine) this.focusOn(mine.x, mine.y);
      }
    }
    this.host.onFrame();
  }

  private syncCitizens(state: GameState, delta: number, time: number) {
    const seen = new Set<number>();
    const ease = Math.min(1, (delta / 1000) * 9);
    for (const c of state.citizens) {
      seen.add(c.id);
      const p = toScreen(c.x, c.y);
      let view = this.citizenViews.get(c.id);
      if (!view) {
        const sprite = this.add.image(p.x, p.y, citizenKey(c.owner, c.job)).setOrigin(0.45, 0.9).setScale(pxScale * 1.15);
        view = { sprite, x: p.x, y: p.y, job: c.job };
        this.citizenViews.set(c.id, view);
      }
      if (view.job !== c.job) {
        view.job = c.job;
        view.sprite.setTexture(citizenKey(c.owner, c.job));
      }
      const dx = p.x - view.x;
      view.x += dx * ease;
      view.y += (p.y - view.y) * ease;
      const phase = time * 0.012 + c.id;
      let bob = 0;
      let lean = 0;
      if (c.state === 'walk') bob = Math.abs(Math.sin(phase)) * 1.3;
      else if (c.state === 'work') lean = Math.sin(phase * 0.9) * 0.2;
      if (Math.abs(dx) > 0.02) view.sprite.setFlipX(dx < 0);
      view.sprite.setPosition(view.x, view.y - bob).setRotation(lean).setDepth(view.y + 1);
    }
    for (const [id, view] of this.citizenViews) {
      if (seen.has(id)) continue;
      view.sprite.destroy();
      this.citizenViews.delete(id);
    }
  }

  private syncExpeditions(state: GameState, delta: number, time: number) {
    const ease = Math.min(1, (delta / 1000) * 9);
    const seen = new Set<number>();
    for (const e of state.expeditions) {
      seen.add(e.id);
      const p = toScreen(e.x, e.y);
      let view = this.expeditionViews.get(e.id);
      if (!view) {
        const sprites = Array.from({ length: e.settlers }, () =>
          this.add.image(p.x, p.y, citizenKey(e.owner, 'idle')).setOrigin(0.45, 0.9).setScale(pxScale * 1.15),
        );
        view = { sprites, x: p.x, y: p.y };
        this.expeditionViews.set(e.id, view);
      }
      const dx = p.x - view.x;
      view.x += dx * ease;
      view.y += (p.y - view.y) * ease;
      view.sprites.forEach((sprite, i) => {
        const bob = Math.abs(Math.sin(time * 0.012 + i * 1.7)) * 1.3;
        const y = view.y + (i - 1) * 3;
        sprite.setPosition(view.x - Math.sign(dx || 1) * i * 6, y - bob).setFlipX(dx < 0).setDepth(y + 1);
      });
    }
    for (const [id, view] of this.expeditionViews) {
      if (seen.has(id)) continue;
      view.sprites.forEach((sprite) => sprite.destroy());
      this.expeditionViews.delete(id);
    }
  }

  private syncNodes(state: GameState, time: number) {
    for (const [id, sprite] of this.nodeViews) {
      const node = state.nodes[id];
      if (node.amount === 0) {
        this.nodeViews.delete(id);
        this.removeNode(node, sprite);
        continue;
      }
      if (node.kind !== 'tree') {
        const ratio = 0.55 + (node.amount / node.max) * 0.45;
        sprite.setScale(pxScale * sprite.getData('size') * ratio);
      }
      sprite.setRotation(node.users > 0 && node.kind === 'tree' ? Math.sin(time * 0.014 + id) * 0.04 : 0);
    }
  }

  private removeNode(node: ResourceNode, sprite: Phaser.GameObjects.Image) {
    if (node.kind !== 'tree') {
      this.tweens.add({ targets: sprite, alpha: 0, duration: 400, onComplete: () => sprite.destroy() });
      return;
    }
    const p = toScreen(node.x, node.y);
    this.add.image(p.x, p.y, 'stump').setOrigin(0.5, 0.75).setScale(pxScale).setDepth(p.y - 1);
    this.tweens.add({
      targets: sprite,
      rotation: 1.5,
      alpha: 0,
      duration: 650,
      ease: 'Quad.easeIn',
      onComplete: () => sprite.destroy(),
    });
  }

  private syncBases(state: GameState) {
    for (const base of state.bases) {
      let view = this.baseViews.get(base.id);
      if (!view) {
        const p = toScreen(base.x, base.y);
        const hall = this.add
          .image(p.x, p.y, buildingKey('hall', base.owner))
          .setOrigin(0.5, 0.86)
          .setScale(pxScale)
          .setDepth(p.y);
        const label = this.add
          .text(p.x, p.y + 14, '', {
            fontFamily: 'system-ui, sans-serif',
            fontSize: `${LABEL_FONT}px`,
            fontStyle: '700',
            color: '#ffffff',
            stroke: '#21302a',
            strokeThickness: 7,
          })
          .setOrigin(0.5, 0)
          .setDepth(100000);
        view = { hall, label };
        this.baseViews.set(base.id, view);
        this.tweens.add({ targets: hall, scale: { from: 0, to: pxScale }, duration: 350, ease: 'Back.easeOut' });
      }
      view.label.setText(`${base.name}  ${citizensOf(state, base.id).length}/${capacityOf(state, base)}`);
      view.label.setScale((LABEL_SIZE * this.dpr) / LABEL_FONT / this.cameras.main.zoom);
    }
  }

  private syncBuildings(state: GameState, time: number) {
    for (const building of state.buildings) {
      const view = this.buildingViews.get(building.id) ?? this.addBuilding(building);
      if (building.done && !view.done) this.finishBuilding(building, view);
      view.bar.clear();
      if (needsWork(building)) {
        const ratio = Math.min(1, building.progress / building.required);
        const p = toScreen(building.x, building.y);
        view.bar.fillStyle(0x21302a, 0.8).fillRoundedRect(p.x - 15, p.y + 7, 30, 5, 2);
        view.bar.fillStyle(0xffd35c, 1).fillRoundedRect(p.x - 14, p.y + 8, 28 * ratio, 3, 1.5);
      }
      if (building.level > 1 && !view.star) {
        const p = toScreen(building.x, building.y);
        view.star = this.add.image(p.x + 13, p.y - 2, 'upgrade-star').setScale(pxScale).setDepth(p.y + 2);
      }
      if (building.done && building.type === 'farm') {
        const stage = Math.floor((time * 0.00025 + building.id) % 3);
        view.sprite.setTexture(`crops-${stage}`);
      }
    }
  }

  private addBuilding(building: Building): BuildingView {
    const p = toScreen(building.x, building.y);
    const sprite = this.add.image(p.x, p.y, 'scaffold').setOrigin(0.5, 0.85).setScale(pxScale).setDepth(p.y);
    const bar = this.add.graphics().setDepth(99999);
    const view: BuildingView = { sprite, bar, done: false };
    this.buildingViews.set(building.id, view);
    return view;
  }

  private finishBuilding(building: Building, view: BuildingView) {
    view.done = true;
    const p = toScreen(building.x, building.y);
    if (building.type === 'farm') {
      view.sprite.setTexture('crops-0').setOrigin(0.5, 0.5).setDepth(p.y - 12);
      view.flag = this.add
        .image(p.x - 22, p.y + 4, buildingKey('farm', building.owner))
        .setOrigin(0.27, 0.92)
        .setScale(pxScale)
        .setDepth(p.y);
    } else {
      view.sprite.setTexture(buildingKey(building.type, building.owner)).setOrigin(0.5, 0.88);
    }
    this.tweens.add({ targets: view.sprite, scale: { from: pxScale * 0.7, to: pxScale }, duration: 280, ease: 'Back.easeOut' });
  }

  private syncSiteMarks(state: GameState, time: number) {
    const draft = state.phase.kind === 'draft' || this.host.selection().picking;
    const selected = this.host.selection().siteId;
    for (const site of state.map.sites) {
      const mark = this.siteMarks.get(site.id)!;
      mark.setDepth(draft ? 90000 : -4);
      mark.clear();
      if (!draft || state.bases.some((b) => b.siteId === site.id)) continue;
      const open = siteAvailability(state, site) === null;
      const { rx, ry } = ellipseOf(19 + (open ? Math.sin(time * 0.005) * 2 : 0));
      const isSelected = selected === site.id;
      const color = open ? 0xfff3b0 : 0x8a3b3b;
      mark.fillStyle(color, isSelected ? 0.7 : open ? 0.45 : 0.2);
      mark.fillEllipse(0, 0, rx * 2, ry * 2);
      mark.lineStyle(isSelected ? 5 : 3, isSelected ? 0xffb300 : 0xffffff, open ? 1 : 0.35);
      mark.strokeEllipse(0, 0, rx * 2, ry * 2);
    }
  }

  private drawInfluence(state: GameState) {
    this.influence.clear();
    const { baseId, siteId } = this.host.selection();
    const center =
      baseId !== null
        ? state.bases.find((b) => b.id === baseId)
        : siteId !== null
          ? state.map.sites[siteId]
          : undefined;
    if (!center) return;
    const p = toScreen(center.x, center.y);
    const { rx, ry } = ellipseOf(BASE_RADIUS);
    this.influence.fillStyle(0xffffff, 0.12).fillEllipse(p.x, p.y, rx * 2, ry * 2);
    this.influence.lineStyle(2.5, 0xffffff, 0.75).strokeEllipse(p.x, p.y, rx * 2, ry * 2);
  }
}
