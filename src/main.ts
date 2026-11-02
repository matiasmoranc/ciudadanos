import Phaser from 'phaser';
import { TOTAL_ROUNDS } from './core/config';
import { createGame } from './core/game';
import type { GameState } from './core/types';
import { WorldScene } from './render/WorldScene';
import type { SceneHost } from './render/WorldScene';
import { Hud } from './ui/hud';
import './ui/styles.css';

const PLAYERS = [
  { name: 'Verde', color: 0x3fa45f },
  { name: 'Azul', color: 0x3d7dd8 },
  { name: 'Rojo', color: 0xd9483b },
  { name: 'Amarillo', color: 0xe6b422 },
];

const params = new URLSearchParams(location.search);
const hudRoot = document.querySelector<HTMLElement>('#hud')!;
const dpr = Math.min(2, window.devicePixelRatio || 1);

let game: Phaser.Game | null = null;
let rivals = 3;

function showMenu() {
  game?.destroy(true);
  game = null;
  const choices = [1, 2, 3]
    .map((n) => `<button class="choice${n === rivals ? ' on' : ''}" data-rivals="${n}">${n}</button>`)
    .join('');
  hudRoot.innerHTML = `<div class="menu-wrap"><div class="menu">
    <h1>Ciudadanos</h1>
    <p>Vos decidís. Tu civilización hace el resto.</p>
    <ol>
      <li>Elegí dos lugares para fundar tus bases.</li>
      <li>Tocá una base y repartí a sus ciudadanos con + y −.</li>
      <li>Trabajan solos, incluso en los turnos de los demás.</li>
      <li>Cuidá la comida y el agua: sin ellas, tu gente muere.</li>
      <li>Construí casas, reproducite y sumá más puntos en ${TOTAL_ROUNDS} rondas.</li>
    </ol>
    <div class="field">Bots rivales</div>
    <div class="choices">${choices}</div>
    <button class="primary" id="start">Empezar partida</button>
  </div></div>`;
  hudRoot.querySelectorAll<HTMLElement>('[data-rivals]').forEach((button) => {
    button.addEventListener('click', () => {
      rivals = Number(button.dataset.rivals);
      showMenu();
    });
  });
  hudRoot.querySelector('#start')!.addEventListener('click', () => {
    hudRoot.innerHTML = '<div class="menu-wrap"><div class="menu"><h1>Creando el mundo…</h1></div></div>';
    setTimeout(start, 30);
  });
}

function start() {
  const seed = Number(params.get('seed')) || Math.floor(Math.random() * 1e9);
  const setups = PLAYERS.slice(0, rivals + 1).map((p, i) => ({ ...p, isBot: i > 0 }));
  const state: GameState = createGame(seed, setups);

  const hud = new Hud(hudRoot, state, showMenu, (base) => scene()?.focusOn(base.x, base.y));
  const host: SceneHost = {
    state,
    speed: Number(params.get('speed')) || 1,
    selection: () => ({ baseId: hud.selectedBase, siteId: hud.selectedSite }),
    onTapBase: (id) => hud.tapBase(id),
    onTapSite: (id) => hud.tapSite(id),
    onTapEmpty: () => hud.tapEmpty(),
    onFrame: () => hud.frame(),
  };

  const size = () => ({ width: Math.round(innerWidth * dpr), height: Math.round(innerHeight * dpr) });
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#2f86b3',
    scale: { mode: Phaser.Scale.NONE, ...size(), zoom: 1 / dpr },
    antialias: true,
    banner: false,
    scene: [],
  });
  const current = game;
  const scene = () => current.scene.getScene('world') as WorldScene | null;
  current.scene.add('world', WorldScene, true, { host, dpr });

  const resize = () => {
    if (game !== current) {
      removeEventListener('resize', resize);
      return;
    }
    const { width, height } = size();
    current.scale.resize(width, height);
    current.scale.setZoom(1 / dpr);
  };
  addEventListener('resize', resize);

  if (params.has('debug')) Object.assign(window, { ciudadanos: { state, hud, host } });
}

showMenu();
