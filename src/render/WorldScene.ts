import Phaser from 'phaser';
import { BASE_RADIUS, TICKS_PER_SECOND } from '../core/config';
import { moistureYield } from '../core/ecology';
import { capacityOf, citizensOf, needsWork, siteAvailability } from '../core/game';
import { troopCount, wallEnds } from '../core/war';
import { stepMatch } from '../core/match';
import type { Army, Base, Building, Citizen, GameState, Point, ResourceNode } from '../core/types';
import { ART_SCALE, buildingKey, citizenKey, createArt, soldierKey } from './art';
import { EcologyView } from './ecology';
import { MAP_HEIGHT, MAP_WIDTH, TERRAIN_SCALE, ellipseOf, toScreen, toWorld } from './iso';
import { paintTerrain } from './terrain';

export interface SceneHost {
  state: GameState;
  speed: number;
  selection(): { baseId: number | null; siteId: number | null; armyId: number | null; picking: boolean };
  onTapBase(id: number): void;
  onTapSite(id: number): void;
  onTapArmy(id: number): void;
  onTapEmpty(point: Point): void;
  onFrame(): void;
}

const STEP_MS = 1000 / TICKS_PER_SECOND;
const TAP_SLOP = 10;
const LABEL_FONT = 30;
const LABEL_SIZE = 12;
const ARMY_SPRITES = 5;
const WALL_HEIGHT = 11;
const pxScale = 1 / ART_SCALE;

interface CitizenView {
  sprite: Phaser.GameObjects.Image;
  x: number;
  y: number;
  job: Citizen['job'];
  owner: number;
}

interface BuildingView {
  sprite?: Phaser.GameObjects.Image;
  wall?: Phaser.GameObjects.Graphics;
  flag?: Phaser.GameObjects.Image;
  bar: Phaser.GameObjects.Graphics;
  star?: Phaser.GameObjects.Image;
  done: boolean;
  owner: number;
}

interface ArmyView {
  sprites: Phaser.GameObjects.Image[];
  label: Phaser.GameObjects.Text;
  x: number;
  y: number;
}

interface ExpeditionView {
  sprites: Phaser.GameObjects.Image[];
  x: number;
  y: number;
}

interface BaseView {
  hall: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  owner: number;
}

export class WorldScene extends Phaser.Scene {
  private host!: SceneHost;
  private accumulator = 0;
  private lastSync = 0;
  private dpr = 1;

  private nodeViews = new Map<number, Phaser.GameObjects.Image>();
  private stumps = new Map<number, Phaser.GameObjects.Image>();
  private ecology!: EcologyView;
  private citizenViews = new Map<number, CitizenView>();
  private buildingViews = new Map<number, BuildingView>();
  private baseViews = new Map<number, BaseView>();
  private expeditionViews = new Map<number, ExpeditionView>();
  private armyViews = new Map<number, ArmyView>();
  private routes!: Phaser.GameObjects.Graphics;
  private arrows!: Phaser.GameObjects.Graphics;
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
    this.add.image(0, 0, 'terrain').setOrigin(0).setScale(1 / TERRAIN_SCALE).setDepth(-10);
    createArt(this, state.players.map((p) => p.color));

    this.influence = this.add.graphics().setDepth(90001);
    this.routes = this.add.graphics().setDepth(90002);
    this.arrows = this.add.graphics().setDepth(90003);
    for (const peak of state.map.peaks) {
      const p = toScreen(peak.x, peak.y);
      this.add.image(p.x, p.y, 'peak').setOrigin(0.5, 0.92).setScale(pxScale * 3 * peak.size * 0.42).setDepth(p.y);
    }
    for (const node of state.nodes) this.addNode(node);
    for (const site of state.map.sites) {
      const p = toScreen(site.x, site.y);
      this.siteMarks.set(site.id, this.add.graphics({ x: p.x, y: p.y }).setDepth(-4));
    }

    this.ecology = new EcologyView(
      this,
      state,
      (nodeIds, tint) => this.tintNodes(nodeIds, tint),
      (owner) => {
        if (owner === 0) this.cameras.main.shake(320, 0.004);
      },
    );

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

  private tintNodes(nodeIds: number[], tint: number) {
    for (const id of nodeIds) {
      if (this.host.state.nodes[id].kind === 'tree') this.nodeViews.get(id)?.setTint(tint);
    }
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
    cam.setZoom(Math.max(this.minZoom(), Math.min(cam.width / 2050, cam.height / 1200)));
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
    const reach = Math.max(46, (34 * this.dpr) / this.cameras.main.zoom);
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
      else this.host.onTapEmpty(toWorld(worldX, worldY));
      return;
    }
    let armyHit: Army | null = null;
    let armyDistance = reach;
    for (const army of state.armies) {
      const d = distanceTo(army.x, army.y);
      if (d < armyDistance) {
        armyDistance = d;
        armyHit = army;
      }
    }
    if (armyHit) {
      this.host.onTapArmy(armyHit.id);
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
    else this.host.onTapEmpty(toWorld(worldX, worldY));
  }

  focusOn(x: number, y: number) {
    const p = toScreen(x, y);
    const cam = this.cameras.main;
    this.tweens.add({
      targets: cam,
      zoom: Math.max(this.minZoom(), 1.3 * this.dpr),
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
    this.syncArmies(state, delta, time);
    this.ecology.frame(state, delta, time);
    if (time - this.lastSync > 120) {
      this.lastSync = time;
      this.syncNodes(state, time);
      this.ecology.sync(state, time);
      this.syncBases(state);
      this.syncBuildings(state, time);
      this.syncSiteMarks(state, time);
      this.drawInfluence(state);
      this.drawRoutes(state);
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
        view = { sprite, x: p.x, y: p.y, job: c.job, owner: c.owner };
        this.citizenViews.set(c.id, view);
      }
      if (view.job !== c.job || view.owner !== c.owner) {
        view.job = c.job;
        view.owner = c.owner;
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

  private syncArmies(state: GameState, delta: number, time: number) {
    const ease = Math.min(1, (delta / 1000) * 9);
    const seen = new Set<number>();
    const labelScale = (LABEL_SIZE * this.dpr) / LABEL_FONT / this.cameras.main.zoom;
    for (const army of state.armies) {
      seen.add(army.id);
      const p = toScreen(army.x, army.y);
      let view = this.armyViews.get(army.id);
      if (!view) {
        const label = this.add
          .text(p.x, p.y, '', {
            fontFamily: 'system-ui, sans-serif',
            fontSize: `${LABEL_FONT}px`,
            fontStyle: '800',
            color: '#ffffff',
            stroke: '#21302a',
            strokeThickness: 7,
          })
          .setOrigin(0.5, 1)
          .setDepth(100001);
        view = { sprites: [], label, x: p.x, y: p.y };
        this.armyViews.set(army.id, view);
      }
      const shown = Math.min(ARMY_SPRITES, troopCount(army));
      while (view.sprites.length > shown) view.sprites.pop()!.destroy();
      while (view.sprites.length < shown) {
        view.sprites.push(this.add.image(p.x, p.y, soldierKey(army.owner, 'common')).setOrigin(0.45, 0.9).setScale(pxScale * 1.25));
      }
      const dx = p.x - view.x;
      view.x += dx * ease;
      view.y += (p.y - view.y) * ease;
      const clash = army.fighting || army.sieging;
      view.sprites.forEach((sprite, i) => {
        const heavy = i < army.heavy;
        const key = soldierKey(army.owner, heavy ? 'heavy' : 'common');
        if (sprite.texture.key !== key) sprite.setTexture(key);
        const phase = time * 0.012 + i * 1.3;
        const offsetX = ((i % 3) - 1) * 9;
        const y = view.y + (Math.floor(i / 3) - 0.5) * 7 + (i % 3) * 2;
        const bob = clash ? 0 : Math.abs(Math.sin(phase)) * 1.2;
        const lunge = clash ? Math.sin(phase * 2.4) * 2.4 : 0;
        sprite
          .setPosition(view.x + offsetX + lunge, y - bob)
          .setRotation(clash ? Math.sin(phase * 2.4) * 0.25 : 0)
          .setFlipX(dx < 0)
          .setDepth(y + 1);
      });
      view.label
        .setText(`${clash ? '⚔ ' : ''}${troopCount(army)}`)
        .setPosition(view.x, view.y - 20)
        .setScale(labelScale);
    }
    for (const [id, view] of this.armyViews) {
      if (seen.has(id)) continue;
      view.sprites.forEach((sprite) => sprite.destroy());
      view.label.destroy();
      this.armyViews.delete(id);
    }
  }

  /** Marca el camino de los ejércitos que vienen hacia mí y el del seleccionado. */
  private drawRoutes(state: GameState) {
    this.routes.clear();
    const selected = this.host.selection().armyId;
    const width = Math.max(2, (2 * this.dpr) / this.cameras.main.zoom);
    for (const army of state.armies) {
      const order = army.order;
      const attackingMe =
        order.kind === 'attack' && army.owner !== 0 && state.bases.find((b) => b.id === order.baseId)?.owner === 0;
      if (!attackingMe && army.id !== selected) continue;
      const points = [army, ...army.path.slice(army.leg)].map((p) => toScreen(p.x, p.y));
      this.routes.lineStyle(width, attackingMe ? 0xff5040 : 0xffffff, 0.85);
      for (let i = 0; i + 1 < points.length; i++) {
        const a = points[i];
        const b = points[i + 1];
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        const dashes = Math.floor(length / 26);
        for (let d = 0; d < dashes; d += 2) {
          this.routes.lineBetween(
            a.x + ((b.x - a.x) * d) / dashes,
            a.y + ((b.y - a.y) * d) / dashes,
            a.x + ((b.x - a.x) * (d + 1)) / dashes,
            a.y + ((b.y - a.y) * (d + 1)) / dashes,
          );
        }
      }
    }
    this.arrows.clear();
    for (const shot of state.shots) {
      const from = toScreen(shot.x1, shot.y1);
      const to = toScreen(shot.x2, shot.y2);
      this.arrows.lineStyle(2, 0xfff1b0, 1).lineBetween(from.x, from.y - 34, to.x, to.y - 8);
    }
  }

  private syncNodes(state: GameState, time: number) {
    for (const [id, sprite] of this.nodeViews) {
      const node = state.nodes[id];
      if (node.amount === 0 && node.growth === 0) {
        if (sprite.visible) this.removeNode(node, sprite);
        continue;
      }
      const size = pxScale * sprite.getData('size');
      if (!sprite.visible) {
        sprite.setVisible(true);
        this.stumps.get(id)?.destroy();
        this.stumps.delete(id);
      }
      if (node.growth > 0) {
        sprite.setScale(size * (0.22 + node.growth * 0.78));
        continue;
      }
      if (node.kind === 'tree') sprite.setScale(size);
      else sprite.setScale(size * (0.55 + (node.amount / node.max) * 0.45));
      sprite.setAlpha(node.closed === 'rubble' ? 0.45 : 1);
      sprite.setRotation(node.users > 0 && node.kind === 'tree' ? Math.sin(time * 0.014 + id) * 0.04 : 0);
    }
  }

  private removeNode(node: ResourceNode, sprite: Phaser.GameObjects.Image) {
    // Cae una copia: el nodo conserva su imagen por si vuelve a crecer.
    const falling = this.add
      .image(sprite.x, sprite.y, sprite.texture.key)
      .setOrigin(sprite.originX, sprite.originY)
      .setScale(sprite.scaleX)
      .setTint(sprite.tintTopLeft)
      .setDepth(sprite.depth);
    sprite.setVisible(false).setRotation(0);
    if (node.kind !== 'tree') {
      this.tweens.add({ targets: falling, alpha: 0, duration: 400, onComplete: () => falling.destroy() });
      return;
    }
    const p = toScreen(node.x, node.y);
    this.stumps.set(node.id, this.add.image(p.x, p.y, 'stump').setOrigin(0.5, 0.75).setScale(pxScale).setDepth(p.y - 1));
    this.tweens.add({
      targets: falling,
      rotation: 1.5,
      alpha: 0,
      duration: 650,
      ease: 'Quad.easeIn',
      onComplete: () => falling.destroy(),
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
        view = { hall, label, owner: base.owner };
        this.baseViews.set(base.id, view);
        this.tweens.add({ targets: hall, scale: { from: 0, to: pxScale }, duration: 350, ease: 'Back.easeOut' });
      }
      if (view.owner !== base.owner) {
        view.owner = base.owner;
        view.hall.setTexture(buildingKey('hall', base.owner));
      }
      const soldiers = troopCount(base.garrison);
      const guard = soldiers > 0 ? `  ⚔${soldiers}` : '';
      view.label.setText(`${base.name}  ${citizensOf(state, base.id).length}/${capacityOf(state, base)}${guard}`);
      view.label.setScale((LABEL_SIZE * this.dpr) / LABEL_FONT / this.cameras.main.zoom);
    }
  }

  private syncBuildings(state: GameState, time: number) {
    const alive = new Set(state.buildings.map((b) => b.id));
    for (const [id, view] of this.buildingViews) {
      if (alive.has(id)) continue;
      view.sprite?.destroy();
      view.wall?.destroy();
      view.flag?.destroy();
      view.star?.destroy();
      view.bar.destroy();
      this.buildingViews.delete(id);
    }
    for (const building of state.buildings) {
      const view = this.buildingViews.get(building.id) ?? this.addBuilding(state, building);
      if (building.done && !view.done) this.finishBuilding(state, building, view);
      if (view.owner !== building.owner) {
        view.owner = building.owner;
        if (building.done && building.type !== 'farm' && view.sprite) {
          view.sprite.setTexture(buildingKey(building.type, building.owner));
        }
        view.flag?.setTexture(buildingKey('farm', building.owner));
      }
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
        const base = state.bases.find((b) => b.id === building.baseId);
        const vigor = base ? building.soil * moistureYield(state.eco[base.siteId]) : 1;
        // Una tierra cansada no llega a dar espigas altas.
        const stage = Math.floor((time * 0.00025 + building.id) % (vigor < 0.65 ? 2 : 3));
        view.sprite?.setTexture(`crops-${stage}`);
        view.sprite?.setTint(vigor < 0.85 ? 0xd9b77a : 0xffffff);
      }
    }
  }

  private addBuilding(state: GameState, building: Building): BuildingView {
    const p = toScreen(building.x, building.y);
    const bar = this.add.graphics().setDepth(99999);
    const view: BuildingView = { bar, done: false, owner: building.owner };
    if (building.slot !== null) {
      view.wall = this.add.graphics().setDepth(p.y);
      this.paintWall(state, building, view.wall, 0.45);
    } else {
      view.sprite = this.add.image(p.x, p.y, 'scaffold').setOrigin(0.5, 0.85).setScale(pxScale).setDepth(p.y);
    }
    this.buildingViews.set(building.id, view);
    return view;
  }

  private paintWall(state: GameState, building: Building, wall: Phaser.GameObjects.Graphics, alpha: number) {
    const base = state.bases.find((b) => b.id === building.baseId);
    if (!base || building.slot === null) return;
    const [a, b] = wallEnds(base, building.slot).map((point) => toScreen(point.x, point.y));
    const stone = building.type === 'wallStone';
    const side = stone ? 0x9b9a96 : 0x9a6f43;
    const top = stone ? 0xc4c3bf : 0xbd9160;
    const tall = stone ? WALL_HEIGHT + 3 : WALL_HEIGHT;
    wall.clear();
    wall.fillStyle(side, alpha);
    wall.fillPoints(
      [
        { x: a.x, y: a.y },
        { x: b.x, y: b.y },
        { x: b.x, y: b.y - tall },
        { x: a.x, y: a.y - tall },
      ],
      true,
    );
    wall.lineStyle(4, top, alpha).lineBetween(a.x, a.y - tall, b.x, b.y - tall);
  }

  private finishBuilding(state: GameState, building: Building, view: BuildingView) {
    view.done = true;
    if (view.wall) {
      this.paintWall(state, building, view.wall, 1);
      return;
    }
    const p = toScreen(building.x, building.y);
    if (!view.sprite) return;
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
      mark.setScale(Math.max(1, (0.9 * this.dpr) / this.cameras.main.zoom));
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
