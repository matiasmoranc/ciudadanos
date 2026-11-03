import type Phaser from 'phaser';
import type { Job, SoldierKind } from '../core/types';

/** Todo el arte se dibuja por código: sin imágenes externas y nítido con zoom. */
export const ART_SCALE = 3;

type Ctx = CanvasRenderingContext2D;

function make(scene: Phaser.Scene, key: string, w: number, h: number, draw: (c: Ctx) => void) {
  if (scene.textures.exists(key)) return;
  const canvas = document.createElement('canvas');
  canvas.width = w * ART_SCALE;
  canvas.height = h * ART_SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(ART_SCALE, ART_SCALE);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  draw(ctx);
  scene.textures.addCanvas(key, canvas);
}

const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

function shadow(c: Ctx, x: number, y: number, rx: number, ry: number) {
  c.fillStyle = 'rgba(30, 40, 30, 0.26)';
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.fill();
}

function blob(c: Ctx, x: number, y: number, r: number, fill: string) {
  c.fillStyle = fill;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
}

function poly(c: Ctx, points: number[], fill: string) {
  c.fillStyle = fill;
  c.beginPath();
  c.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) c.lineTo(points[i], points[i + 1]);
  c.closePath();
  c.fill();
}

/** Bloque isométrico: frente izquierdo, frente derecho. */
function walls(c: Ctx, cx: number, base: number, w: number, tall: number, left: string, right: string) {
  poly(c, [cx - w, base - w * 0.5, cx, base, cx, base - tall, cx - w, base - w * 0.5 - tall], left);
  poly(c, [cx + w, base - w * 0.5, cx, base, cx, base - tall, cx + w, base - w * 0.5 - tall], right);
}

function roof(c: Ctx, cx: number, base: number, w: number, tall: number, peak: number, left: string, right: string) {
  const top = base - tall;
  poly(c, [cx - w - 2, top - w * 0.5, cx, top + 2, cx, top - peak], left);
  poly(c, [cx + w + 2, top - w * 0.5, cx, top + 2, cx, top - peak], right);
  poly(c, [cx - w - 2, top - w * 0.5, cx, top - peak, cx + w + 2, top - w * 0.5, cx, top - w], left);
}

function flag(c: Ctx, x: number, y: number, tall: number, color: string) {
  c.strokeStyle = '#5b4632';
  c.lineWidth = 1.2;
  c.beginPath();
  c.moveTo(x, y);
  c.lineTo(x, y - tall);
  c.stroke();
  poly(c, [x, y - tall, x + 9, y - tall + 2.5, x, y - tall + 6], color);
}

function drawDoor(c: Ctx, cx: number, base: number) {
  poly(c, [cx + 3, base - 2, cx + 8, base - 4.5, cx + 8, base - 12, cx + 3, base - 9.5], '#6d4a2e');
}

export const CITIZEN_JOBS: (Job | 'idle')[] = ['idle', 'wood', 'stone', 'food', 'water', 'build', 'reproduce'];

function drawTool(c: Ctx, job: Job | 'idle') {
  c.lineWidth = 1.3;
  if (job === 'wood' || job === 'stone' || job === 'build') {
    c.strokeStyle = '#7a5532';
    c.beginPath();
    c.moveTo(11, 13);
    c.lineTo(14.5, 6);
    c.stroke();
    c.fillStyle = job === 'wood' ? '#d7dde0' : job === 'stone' ? '#9aa2a8' : '#5f6a70';
    c.fillRect(12.2, 3.8, 5, 2.6);
  } else if (job === 'water') {
    c.fillStyle = '#7a5532';
    c.fillRect(11, 10, 4.6, 4.4);
    c.fillStyle = '#6fd0ec';
    c.fillRect(11.6, 10.3, 3.4, 1.5);
  } else if (job === 'food') {
    c.fillStyle = '#d9a441';
    c.beginPath();
    c.ellipse(13, 11.5, 2.8, 3.2, 0, 0, Math.PI * 2);
    c.fill();
  } else if (job === 'reproduce') {
    c.fillStyle = '#ef5a7b';
    c.beginPath();
    c.arc(4.6, 2.5, 1.4, 0, Math.PI * 2);
    c.arc(7, 2.5, 1.4, 0, Math.PI * 2);
    c.moveTo(3.2, 3);
    c.lineTo(5.8, 6);
    c.lineTo(8.4, 3);
    c.fill();
  }
}

export const citizenKey = (player: number, job: Job | 'idle') => `citizen-${player}-${job}`;
export const soldierKey = (player: number, kind: SoldierKind) => `soldier-${player}-${kind}`;
export const buildingKey = (type: string, player: number) => `${type}-${player}`;

export function createArt(scene: Phaser.Scene, colors: number[]) {
  make(scene, 'tree-round', 24, 34, (c) => {
    shadow(c, 12, 30, 9, 3.6);
    c.fillStyle = '#7a5532';
    c.fillRect(10.3, 20, 3.4, 10);
    blob(c, 12, 15, 9.4, '#3f8f49');
    blob(c, 7.4, 18, 6, '#3a8444');
    blob(c, 16.6, 18, 6, '#3a8444');
    blob(c, 10, 11.6, 5.4, '#5fb35d');
    blob(c, 15, 13, 3.4, '#6fc168');
  });
  make(scene, 'tree-pine', 22, 38, (c) => {
    shadow(c, 11, 34, 8, 3.2);
    c.fillStyle = '#6d4a2e';
    c.fillRect(9.6, 27, 2.8, 7);
    poly(c, [1.5, 29, 20.5, 29, 11, 13], '#2f7a4a');
    poly(c, [3.5, 21.5, 18.5, 21.5, 11, 7], '#378a52');
    poly(c, [5.5, 14.5, 16.5, 14.5, 11, 2], '#45a05f');
  });
  make(scene, 'stump', 14, 10, (c) => {
    shadow(c, 7, 7.5, 5.5, 2);
    c.fillStyle = '#7a5532';
    c.fillRect(4, 3, 6, 4);
    c.fillStyle = '#d8b98a';
    c.beginPath();
    c.ellipse(7, 3, 3, 1.5, 0, 0, Math.PI * 2);
    c.fill();
  });
  make(scene, 'rubble', 34, 22, (c) => {
    shadow(c, 17, 18, 15, 3.8);
    poly(c, [3, 18, 8, 9, 15, 11, 18, 18], '#8d8f93');
    poly(c, [13, 19, 18, 6, 26, 8, 31, 18, 22, 20], '#74767b');
    poly(c, [18, 6, 26, 8, 23, 12, 17, 11], '#b5b7ba');
    poly(c, [8, 9, 15, 11, 12, 13, 7, 12], '#a8aaad');
    for (const [x, y] of [[6, 19], [11, 20], [29, 19], [20, 21]]) blob(c, x, y, 1.3, '#6a6c70');
  });
  make(scene, 'cracks', 44, 24, (c) => {
    c.strokeStyle = '#2c2522';
    c.lineWidth = 1.7;
    for (const line of [[3, 13, 11, 11, 17, 14, 23, 9, 31, 12, 41, 7], [17, 14, 15, 20, 19, 23], [23, 9, 27, 3], [31, 12, 36, 17]]) {
      c.beginPath();
      c.moveTo(line[0], line[1]);
      for (let i = 2; i < line.length; i += 2) c.lineTo(line[i], line[i + 1]);
      c.stroke();
    }
  });
  make(scene, 'dust', 16, 16, (c) => {
    const glow = c.createRadialGradient(8, 8, 1, 8, 8, 8);
    glow.addColorStop(0, 'rgba(196, 180, 150, 0.95)');
    glow.addColorStop(1, 'rgba(196, 180, 150, 0)');
    c.fillStyle = glow;
    c.fillRect(0, 0, 16, 16);
  });
  make(scene, 'blot', 64, 64, (c) => {
    const glow = c.createRadialGradient(32, 32, 6, 32, 32, 32);
    glow.addColorStop(0, 'rgba(255, 255, 255, 1)');
    glow.addColorStop(0.6, 'rgba(255, 255, 255, 0.72)');
    glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
    c.fillStyle = glow;
    c.fillRect(0, 0, 64, 64);
  });
  make(scene, 'bird', 12, 6, (c) => {
    c.strokeStyle = '#2b3136';
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(1, 2);
    c.quadraticCurveTo(4, 0.5, 6, 4);
    c.quadraticCurveTo(8, 0.5, 11, 2);
    c.stroke();
  });
  make(scene, 'glint', 10, 4, (c) => {
    c.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(1, 2);
    c.lineTo(9, 2);
    c.stroke();
  });
  make(scene, 'rock', 26, 20, (c) => {
    shadow(c, 13, 16.5, 11, 3.2);
    poly(c, [2, 15, 6, 6, 13, 3, 21, 6, 24, 15, 13, 18], '#8d8f93');
    poly(c, [6, 6, 13, 3, 21, 6, 15, 10, 8, 10], '#b5b7ba');
    poly(c, [15, 10, 21, 6, 24, 15, 16, 17], '#74767b');
  });
  const vein = (key: string, base: string, light: string, fleck: string) =>
    make(scene, key, 26, 20, (c) => {
      shadow(c, 13, 16.5, 11, 3.2);
      poly(c, [2, 15, 6, 6, 13, 3, 21, 6, 24, 15, 13, 18], base);
      poly(c, [6, 6, 13, 3, 21, 6, 15, 10, 8, 10], light);
      for (const [x, y] of [[7, 12], [11, 8], [16, 13], [19, 9], [12, 14]]) blob(c, x, y, 1.5, fleck);
    });
  vein('iron', '#7a6a64', '#9b8880', '#c8683a');
  vein('gold', '#8d8574', '#b0a48c', '#ffd23f');
  make(scene, 'upgrade-star', 14, 14, (c) => {
    blob(c, 7, 7, 6.4, '#21302a');
    c.fillStyle = '#ffd23f';
    c.font = 'bold 11px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('★', 7, 7.4);
  });
  make(scene, 'bush', 20, 16, (c) => {
    shadow(c, 10, 13, 8, 2.6);
    blob(c, 6, 9, 4.6, '#4e9c45');
    blob(c, 14, 9, 4.6, '#4e9c45');
    blob(c, 10, 6.6, 5.2, '#62b553');
    for (const [x, y] of [[6, 8], [10, 5], [14, 9], [9, 10], [13, 5.5]]) blob(c, x, y, 1.2, '#e2465a');
  });
  make(scene, 'peak', 90, 74, (c) => {
    shadow(c, 45, 66, 42, 9);
    poly(c, [4, 66, 45, 6, 45, 72], '#8c8884');
    poly(c, [86, 66, 45, 6, 45, 72], '#6d6a68');
    poly(c, [31, 26, 45, 6, 45, 32, 38, 28], '#f3f6f7');
    poly(c, [59, 26, 45, 6, 45, 32, 52, 29], '#d5dee2');
  });
  make(scene, 'scaffold', 44, 42, (c) => {
    shadow(c, 22, 35, 19, 7);
    poly(c, [22, 40, 3, 30, 22, 21, 41, 30], '#c9a877');
    c.strokeStyle = '#8b6a44';
    c.lineWidth = 1.5;
    for (const [x, y] of [[6, 30], [22, 38], [38, 30], [22, 23]]) {
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x, y - 18);
      c.stroke();
    }
    c.beginPath();
    c.moveTo(6, 19);
    c.lineTo(22, 27);
    c.lineTo(38, 19);
    c.moveTo(6, 12);
    c.lineTo(22, 20);
    c.lineTo(38, 12);
    c.stroke();
  });
  for (let stage = 0; stage < 3; stage++) {
    make(scene, `crops-${stage}`, 60, 34, (c) => {
      poly(c, [30, 33, 2, 18, 30, 3, 58, 18], '#8a6239');
      poly(c, [30, 30, 7, 18, 30, 6, 53, 18], '#9c7145');
      const color = ['#7fc65a', '#a4c84e', '#e0bd47'][stage];
      const tall = 2.4 + stage * 1.6;
      c.strokeStyle = color;
      c.lineWidth = 1.8;
      for (let row = 0; row < 6; row++) {
        for (let i = 0; i < 7; i++) {
          const x = 30 + (i - row) * 4.4;
          const y = 9.5 + (i + row) * 2.2;
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x, y - tall);
          c.stroke();
        }
      }
    });
  }

  colors.forEach((color, player) => {
    const tint = hex(color);
    CITIZEN_JOBS.forEach((job) => {
      make(scene, citizenKey(player, job), 18, 20, (c) => {
        shadow(c, 8, 17.6, 4.4, 1.5);
        c.fillStyle = '#4b3b2e';
        c.fillRect(5.6, 14, 1.9, 3.2);
        c.fillRect(8.4, 14, 1.9, 3.2);
        c.fillStyle = tint;
        c.beginPath();
        c.roundRect(4.2, 7.6, 7.6, 7.4, 2.6);
        c.fill();
        blob(c, 8, 5.4, 3.4, '#f2c9a0');
        c.fillStyle = 'rgba(90, 60, 30, 0.9)';
        c.beginPath();
        c.arc(8, 4.9, 3.4, Math.PI, 0);
        c.fill();
        drawTool(c, job);
      });
    });

    (['common', 'heavy'] as SoldierKind[]).forEach((kind) => {
      make(scene, soldierKey(player, kind), 20, 22, (c) => {
        shadow(c, 9, 19.6, 5, 1.7);
        c.fillStyle = '#3f3a36';
        c.fillRect(6.2, 16, 2.2, 3.2);
        c.fillRect(9.6, 16, 2.2, 3.2);
        c.fillStyle = kind === 'heavy' ? '#8a9199' : tint;
        c.beginPath();
        c.roundRect(4.6, 8.6, 8.8, 8, 2.4);
        c.fill();
        if (kind === 'heavy') {
          c.fillStyle = tint;
          c.fillRect(6.4, 10, 5.2, 4.6);
        }
        blob(c, 9, 6, 3.5, '#f2c9a0');
        c.fillStyle = '#9aa2a8';
        c.beginPath();
        c.arc(9, 5.4, 3.7, Math.PI, 0);
        c.fill();
        c.strokeStyle = '#c9d0d4';
        c.lineWidth = 1.5;
        c.beginPath();
        c.moveTo(14, 15);
        c.lineTo(17.6, 5);
        c.stroke();
        blob(c, 3.8, 12.6, 3, tint);
      });
    });

    make(scene, buildingKey('barracks', player), 58, 52, (c) => {
      shadow(c, 29, 44, 26, 8);
      walls(c, 29, 46, 21, 13, '#b9a07a', '#9c8562');
      roof(c, 29, 46, 21, 13, 10, '#6e675f', '#5b554e');
      poly(c, [10, 34, 18, 38, 18, 30, 10, 26], '#5a4630');
      poly(c, [36, 39, 44, 35, 44, 28, 36, 32], tint);
      flag(c, 29, 23, 12, tint);
    });
    make(scene, buildingKey('tower', player), 34, 62, (c) => {
      shadow(c, 17, 56, 13, 5);
      walls(c, 17, 58, 10, 36, '#c3bdb0', '#a29c8f');
      walls(c, 17, 25, 12, 7, '#d4cec2', '#b5afa2');
      poly(c, [5, 12, 17, 18, 29, 12, 17, 6], tint);
      flag(c, 17, 12, 9, tint);
    });
    make(scene, buildingKey('hall', player), 76, 84, (c) => {
      shadow(c, 38, 72, 35, 11);
      walls(c, 38, 74, 26, 22, '#e8d5ae', '#cdb88f');
      poly(c, [14, 60, 12, 40, 36, 28, 26, 25, 12, 33], '#b38f60');
      roof(c, 38, 74, 26, 22, 22, tint, tint);
      c.fillStyle = 'rgba(0,0,0,0.18)';
      poly(c, [66, 39, 38, 54, 38, 30], 'rgba(0,0,0,0.2)');
      walls(c, 54, 62, 7, 34, '#c7b18a', '#ab9672');
      roof(c, 54, 62, 7, 34, 11, tint, tint);
      poly(c, [65, 28, 54, 16, 54, 33], 'rgba(0,0,0,0.2)');
      drawDoor(c, 38, 74);
      flag(c, 54, 18, 15, tint);
    });
    make(scene, buildingKey('house', player), 46, 46, (c) => {
      shadow(c, 23, 39, 19, 6.5);
      walls(c, 23, 41, 15, 13, '#ecdcb9', '#d3c098');
      roof(c, 23, 41, 15, 13, 13, tint, tint);
      poly(c, [40, 21.5, 23, 15, 23, 30], 'rgba(0,0,0,0.2)');
      drawDoor(c, 23, 41);
      flag(c, 23, 16, 8, tint);
    });
    make(scene, buildingKey('depot', player), 50, 46, (c) => {
      shadow(c, 25, 39, 22, 7);
      walls(c, 25, 41, 18, 14, '#a97c50', '#8c6440');
      c.strokeStyle = '#6d4a2e';
      c.lineWidth = 1;
      for (let i = 1; i < 3; i++) {
        c.beginPath();
        c.moveTo(7, 32 - 14 + i * 4.6);
        c.lineTo(25, 41 - 14 + i * 4.6);
        c.lineTo(43, 32 - 14 + i * 4.6);
        c.stroke();
      }
      roof(c, 25, 41, 18, 14, 7, '#7a5a3c', '#664a30');
      poly(c, [14, 29, 18, 27, 22, 29, 18, 31], tint);
      flag(c, 25, 19, 9, tint);
    });
    make(scene, buildingKey('well', player), 32, 36, (c) => {
      shadow(c, 16, 30, 13, 4.6);
      c.fillStyle = '#97999c';
      c.beginPath();
      c.ellipse(16, 25, 9.6, 5.4, 0, 0, Math.PI * 2);
      c.fill();
      c.fillRect(6.4, 21, 19.2, 5);
      c.fillStyle = '#b5b7ba';
      c.beginPath();
      c.ellipse(16, 21, 9.6, 5.4, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#4fb3d1';
      c.beginPath();
      c.ellipse(16, 21, 7, 3.6, 0, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#7a5532';
      c.lineWidth = 1.6;
      c.beginPath();
      c.moveTo(7, 21);
      c.lineTo(7, 9);
      c.moveTo(25, 21);
      c.lineTo(25, 9);
      c.stroke();
      poly(c, [3, 10, 16, 3, 29, 10, 16, 13], tint);
    });
    make(scene, buildingKey('farm', player), 22, 26, (c) => {
      flag(c, 6, 24, 18, tint);
    });
  });
}
