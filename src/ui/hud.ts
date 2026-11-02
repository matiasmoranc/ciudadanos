import {
  BIRTH_COST,
  BUILDINGS,
  JOBS,
  JOB_INFO,
  MAX_POPULATION,
  RESOURCES,
  RESOURCE_INFO,
  TICKS_PER_SECOND,
  TOTAL_ROUNDS,
  seconds,
} from '../core/config';
import {
  activePlayer,
  assignedTotal,
  capacityOf,
  citizensOf,
  hasSource,
  issue,
  missingFor,
  populationOf,
  ratesFor,
  reproductionStatus,
  scoreOf,
  siteAvailability,
  storageOf,
} from '../core/game';
import type { Base, BuildingType, Command, GameState, Job, ResourceId, Site } from '../core/types';
import { patch } from './patch';

export const ME = 0;

const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;
const STAR_LINE = (count: number) => '★'.repeat(count) + '☆'.repeat(5 - count);
const signed = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(Math.round(value))}`;
const clock = (ticks: number) => {
  const total = Math.max(0, Math.ceil(ticks / TICKS_PER_SECOND));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

const REPRO_TEXT = {
  idle: 'Asigná 2 o más para tener hijos.',
  running: 'En curso.',
  need_two: 'Hacen falta al menos 2.',
  no_housing: 'Sin vivienda libre: construí una casa.',
  no_supplies: `Falta comida o agua (cada nacimiento usa ${BIRTH_COST.food} y ${BIRTH_COST.water}).`,
  cap: `Llegaste al máximo de ${MAX_POPULATION}.`,
};

type Tab = 'jobs' | 'build';

export class Hud {
  selectedBase: number | null = null;
  selectedSite: number | null = null;

  private tab: Tab = 'jobs';
  private openResource: ResourceId | null = null;
  private showRanking = false;
  private lastTurnKey = '';
  private nextRender = 0;

  private top: HTMLElement;
  private panel: HTMLElement;
  private toasts: HTMLElement;
  private banner: HTMLElement;
  private overlay: HTMLElement;

  constructor(
    root: HTMLElement,
    private state: GameState,
    private onRestart: () => void,
    private onFocusBase: (base: Base) => void,
  ) {
    root.innerHTML = `
      <div id="top"></div>
      <div id="panel"></div>
      <div id="toasts"></div>
      <div id="banner"></div>
      <div id="overlay"></div>`;
    this.top = root.querySelector('#top')!;
    this.panel = root.querySelector('#panel')!;
    this.toasts = root.querySelector('#toasts')!;
    this.banner = root.querySelector('#banner')!;
    this.overlay = root.querySelector('#overlay')!;
    root.addEventListener('click', (event) => this.handleClick(event));
  }

  tapBase(id: number) {
    const base = this.state.bases.find((b) => b.id === id);
    if (!base) return;
    this.selectedBase = base.owner === ME ? id : null;
    this.openResource = null;
    this.render();
  }

  tapSite(id: number) {
    this.selectedSite = id;
    this.render();
  }

  tapEmpty() {
    this.selectedBase = null;
    this.selectedSite = null;
    this.openResource = null;
    this.render();
  }

  frame() {
    this.drainEvents();
    const now = performance.now();
    if (now < this.nextRender) return;
    this.nextRender = now + 180;
    this.render();
  }

  private send(cmd: Command) {
    const result = issue(this.state, ME, cmd);
    if (!result.ok) this.toast(result.error, 'warn');
    this.render();
  }

  private handleClick(event: Event) {
    const element = (event.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!element || element.hasAttribute('disabled')) return;
    const { act, job, delta, type, resource, base } = element.dataset;
    const baseId = this.selectedBase;
    switch (act) {
      case 'job':
        if (baseId !== null) this.send({ type: 'setJob', baseId, job: job as Job, delta: Number(delta) });
        break;
      case 'tab':
        this.tab = element.dataset.tab as Tab;
        this.render();
        break;
      case 'close':
        this.selectedBase = null;
        this.render();
        break;
      case 'auto':
        if (baseId !== null) {
          const current = this.state.bases.find((b) => b.id === baseId)!;
          this.send({ type: 'setAutoSurvive', baseId, value: !current.autoSurvive });
        }
        break;
      case 'build':
        if (baseId !== null) this.send({ type: 'build', baseId, building: type as BuildingType });
        break;
      case 'end':
        this.send({ type: 'endTurn' });
        break;
      case 'found':
        if (this.selectedSite !== null) {
          this.send({ type: 'pickSite', siteId: this.selectedSite });
          this.selectedSite = null;
        }
        break;
      case 'resource':
        this.openResource = this.openResource === resource ? null : (resource as ResourceId);
        this.render();
        break;
      case 'ranking':
        this.showRanking = !this.showRanking;
        this.render();
        break;
      case 'goto': {
        const target = this.state.bases.find((b) => b.id === Number(base));
        if (target) {
          this.selectedBase = target.id;
          this.onFocusBase(target);
          this.render();
        }
        break;
      }
      case 'restart':
        this.onRestart();
        break;
    }
  }

  private drainEvents() {
    const { events } = this.state;
    while (events.length > 0) {
      const event = events.shift()!;
      if (event.player === null || event.player === ME) this.toast(event.text, event.level);
    }
  }

  private toast(text: string, level: string) {
    while (this.toasts.children.length >= 3) this.toasts.firstElementChild!.remove();
    const element = document.createElement('div');
    element.className = `toast ${level}`;
    element.textContent = text;
    this.toasts.appendChild(element);
    setTimeout(() => element.remove(), level === 'good' ? 2600 : 5000);
  }

  private render() {
    const s = this.state;
    this.announceTurn(s);
    patch(this.top, this.topHtml(s));
    patch(this.panel, this.panelHtml(s));
    this.panel.className = this.panel.childElementCount > 0 ? 'open' : '';
    patch(this.overlay, s.phase.kind === 'over' ? this.overHtml(s) : '');
  }

  private announceTurn(s: GameState) {
    const active = activePlayer(s);
    const key = `${s.phase.kind}:${active}:${s.round}`;
    if (key === this.lastTurnKey) return;
    this.lastTurnKey = key;
    if (active !== ME || s.phase.kind !== 'decisions') return;
    this.banner.textContent = '¡Es tu turno!';
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
    if ('vibrate' in navigator) navigator.vibrate?.(60);
  }

  private topHtml(s: GameState) {
    const active = activePlayer(s);
    const phase = s.phase;
    const player = active !== null ? s.players[active] : null;
    const label = phase.kind === 'draft' ? 'ELIGE BASE' : phase.kind === 'decisions' ? 'DECISIONES' : 'FIN';
    const remaining = phase.kind === 'over' ? 0 : phase.endsAt - s.tick;
    const nextId = this.nextPlayer(s);
    const next = nextId !== null ? s.players[nextId].name : '—';
    const urgent = remaining < seconds(10) && active === ME;

    const order = s.players
      .map((p) => {
        const classes = `dot${p.id === active ? ' on' : ''}${p.alive ? '' : ' out'}`;
        return `<i class="${classes}" style="background:${hex(p.color)}"></i>`;
      })
      .join('');

    const turn = `
      <button class="turn" data-act="ranking" style="--pc:${player ? hex(player.color) : '#888'}">
        <span class="turn-title">${player ? `JUGADOR ${player.name.toUpperCase()}` : ''} — ${label}</span>
        <span class="turn-sub">
          <b class="time${urgent ? ' urgent' : ''}">${clock(remaining)}</b>
          <span class="sub-text">Siguiente: ${next}</span>
          <span>${phase.kind === 'draft' ? 'Selección' : `Ronda ${s.round}/${TOTAL_ROUNDS}`}</span>
          <span class="order">${order}</span>
        </span>
      </button>`;

    const rates = ratesFor(s, ME);
    const cap = storageOf(s, ME);
    const chips = RESOURCES.map((resource) => {
      const info = RESOURCE_INFO[resource];
      const stock = Math.floor(s.players[ME].stock[resource]);
      const net = rates[resource].net;
      const tone = stock >= cap ? ' full' : stock <= 0 ? ' empty' : net < -0.5 ? ' down' : '';
      return `<button class="chip${tone}" data-act="resource" data-resource="${resource}" aria-label="${info.name}">
        <span class="chip-icon">${info.icon}</span>
        <span class="chip-text"><b>${stock}</b><small>${signed(net)}/min</small></span>
      </button>`;
    }).join('');

    const canEnd = phase.kind === 'decisions' && active === ME;
    const endButton = `<button class="end" data-act="end" ${canEnd ? '' : 'disabled'}>Finalizar turno</button>`;

    return `
      <div class="bar">${turn}<div class="chips">${chips}</div>${endButton}</div>
      ${this.hintHtml(s)}
      ${this.openResource ? this.resourceHtml(s, this.openResource) : ''}
      ${this.showRanking ? this.rankingHtml(s) : ''}`;
  }

  private nextPlayer(s: GameState): number | null {
    const phase = s.phase;
    if (phase.kind === 'draft') return phase.order[phase.index + 1] ?? 0;
    if (phase.kind !== 'decisions') return null;
    for (let i = 1; i <= s.players.length; i++) {
      const player = (phase.player + i) % s.players.length;
      if (s.players[player].alive) return player;
    }
    return null;
  }

  private hintHtml(s: GameState) {
    const active = activePlayer(s);
    let text = '';
    if (s.phase.kind === 'draft') {
      if (active === ME) text = 'Tocá un círculo del mapa para ver qué recursos tiene ese lugar.';
    } else if (s.phase.kind === 'decisions' && s.round === 1 && active === ME && this.selectedBase === null) {
      const assigned = s.bases.some((b) => b.owner === ME && assignedTotal(b) > 0);
      text = assigned
        ? 'Tocá tu otra base y dale trabajo también. Después finalizá el turno.'
        : 'Tocá una de tus bases para repartir a sus ciudadanos.';
    }
    return text ? `<div class="hint">${text}</div>` : '';
  }

  private resourceHtml(s: GameState, resource: ResourceId) {
    const info = RESOURCE_INFO[resource];
    const rate = ratesFor(s, ME)[resource];
    const rows = rate.byBase
      .map((b) => `<div class="pop-row"><span>${b.name}</span><b>${signed(b.rate)}/min</b></div>`)
      .join('');
    return `<div class="pop">
      <h4>${info.icon} ${info.name} — hasta ${storageOf(s, ME)}</h4>
      ${rows || '<div class="pop-row">Todavía no producís.</div>'}
      ${rate.consumption > 0 ? `<div class="pop-row"><span>Consumo de ${populationOf(s, ME)} personas</span><b>${signed(-rate.consumption)}/min</b></div>` : ''}
      <div class="pop-row total"><span>Neto</span><b>${signed(rate.net)}/min</b></div>
    </div>`;
  }

  private rankingHtml(s: GameState) {
    const rows = s.players
      .map((p) => ({ p, score: scoreOf(s, p.id) }))
      .sort((a, b) => b.score.total - a.score.total)
      .map(
        ({ p, score }) => `<div class="pop-row">
          <span><i class="dot" style="background:${hex(p.color)}"></i> ${p.name}</span>
          <b>${score.total} pts</b>
          <small>${score.citizens} hab · ${score.buildings} edif</small>
        </div>`,
      )
      .join('');
    const myBases = s.bases
      .filter((b) => b.owner === ME)
      .map((b) => `<button class="link" data-act="goto" data-base="${b.id}">${b.name}</button>`)
      .join('');
    return `<div class="pop"><h4>Clasificación</h4>${rows}${myBases ? `<div class="links">${myBases}</div>` : ''}</div>`;
  }

  private panelHtml(s: GameState) {
    if (s.phase.kind === 'draft') {
      const site = this.selectedSite !== null ? s.map.sites[this.selectedSite] : null;
      return site ? this.siteHtml(s, site) : '';
    }
    if (this.selectedBase === null) return '';
    const base = s.bases.find((b) => b.id === this.selectedBase);
    return base ? this.baseHtml(s, base) : '';
  }

  private siteHtml(s: GameState, site: Site) {
    const stars = RESOURCES.map(
      (resource) => `<div class="star-row">
        <span>${RESOURCE_INFO[resource].icon} ${RESOURCE_INFO[resource].name}</span>
        <b class="stars">${STAR_LINE(site.stars[resource])}</b>
      </div>`,
    ).join('');
    const problem = siteAvailability(s, site);
    const myTurn = activePlayer(s) === ME;
    return `<header><h3>${site.name}</h3></header>
      <div class="body">
        ${stars}
        <p class="note good">Ventaja: ${site.advantage}</p>
        <p class="note bad">Desventaja: ${site.disadvantage}</p>
        ${problem ? `<p class="note bad">${problem}</p>` : ''}
        <button class="primary" data-act="found" ${problem || !myTurn ? 'disabled' : ''}>
          ${myTurn ? 'Fundar base aquí' : 'Esperá tu turno'}
        </button>
      </div>`;
  }

  private baseHtml(s: GameState, base: Base) {
    const population = citizensOf(s, base.id).length;
    const capacity = capacityOf(s, base);
    const free = population - assignedTotal(base);
    const myTurn = activePlayer(s) === ME && s.phase.kind === 'decisions';
    const tabs = (['jobs', 'build'] as Tab[])
      .map(
        (tab) =>
          `<button class="tab${this.tab === tab ? ' on' : ''}" data-act="tab" data-tab="${tab}">${tab === 'jobs' ? 'Trabajos' : 'Construir'}</button>`,
      )
      .join('');
    return `<header>
        <h3>${base.name}</h3>
        <button class="x" data-act="close" aria-label="Cerrar">✕</button>
      </header>
      <div class="stats">
        <span>Población <b>${population} / ${capacity}</b></span>
        <span>Libres <b>${free}</b></span>
      </div>
      ${myTurn ? '' : '<div class="wait">Tus órdenes siguen en marcha. Esperá tu turno para cambiarlas.</div>'}
      <div class="tabs">${tabs}</div>
      <div class="body">
        ${this.tab === 'jobs' ? this.jobsHtml(s, base, free, myTurn) : this.buildHtml(s, base, myTurn)}
      </div>`;
  }

  private jobsHtml(s: GameState, base: Base, free: number, myTurn: boolean) {
    const rows = JOBS.map((job) => {
      const count = base.jobs[job];
      const applied = base.effective[job];
      const info = JOB_INFO[job];
      const moved = applied - count;
      const waiting = job !== 'reproduce' && applied > 0 && !hasSource(s, base, job);
      const note = waiting
        ? `<small class="warn">${job === 'build' ? 'Sin obras pendientes' : 'Sin fuente cerca'}</small>`
        : moved !== 0
          ? `<small class="warn">Supervivencia: ${moved > 0 ? '+' : ''}${moved}</small>`
          : job === 'reproduce' && (count > 0 || applied > 0)
            ? `<small>${REPRO_TEXT[reproductionStatus(s, base)]}</small>`
            : '';
      return `<div class="job">
        <span class="job-icon">${info.icon}</span>
        <span class="job-name">${info.name}${note}</span>
        <button class="step" data-act="job" data-job="${job}" data-delta="-1" ${myTurn && count > 0 ? '' : 'disabled'} aria-label="Quitar">−</button>
        <b class="count">${count}</b>
        <button class="step" data-act="job" data-job="${job}" data-delta="1" ${myTurn && free > 0 ? '' : 'disabled'} aria-label="Agregar">+</button>
      </div>`;
    }).join('');
    return `${rows}
      <button class="toggle" data-act="auto" ${myTurn ? '' : 'disabled'}>
        <span class="switch${base.autoSurvive ? ' on' : ''}"></span>
        Supervivencia automática
      </button>`;
  }

  private buildHtml(s: GameState, base: Base, myTurn: boolean) {
    const player = s.players[ME];
    const pending = s.buildings.filter((b) => b.baseId === base.id && !b.done);
    const queue = pending.length
      ? `<div class="queue">${pending
          .map((b) => `<span>${BUILDINGS[b.type].icon} ${BUILDINGS[b.type].name} ${Math.floor((b.progress / b.required) * 100)}%</span>`)
          .join('')}${base.effective.build === 0 ? '<small class="warn">Sin constructores asignados</small>' : ''}</div>`
      : '';
    const cards = (Object.keys(BUILDINGS) as BuildingType[])
      .map((type) => {
        const info = BUILDINGS[type];
        const missing = missingFor(player, type);
        const costs = RESOURCES.filter((r) => info.cost[r])
          .map((r) => {
            const have = Math.floor(player.stock[r]);
            const need = info.cost[r]!;
            return `<span class="${have < need ? 'lack' : ''}">${RESOURCE_INFO[r].icon} ${have} / ${need}</span>`;
          })
          .join('');
        const lack = missing
          .map((m) => `${m.amount} de ${RESOURCE_INFO[m.resource].name.toLowerCase()}`)
          .join(' y ');
        return `<div class="card">
          <div class="card-head"><b>${info.icon} ${info.name}</b><small>${info.seconds} s</small></div>
          <p>${info.effect}</p>
          <div class="costs">${costs}</div>
          ${lack ? `<small class="lack">Faltan ${lack}.</small>` : ''}
          <button class="primary" data-act="build" data-type="${type}" ${myTurn && !lack ? '' : 'disabled'}>Construir</button>
        </div>`;
      })
      .join('');
    return `${queue}${cards}`;
  }

  private overHtml(s: GameState) {
    if (s.phase.kind !== 'over') return '';
    const winner = s.phase.winner;
    const title = winner === ME ? '¡Ganaste!' : winner === null ? 'Fin de la partida' : 'Perdiste';
    const rows = s.players
      .map((p) => ({ p, score: scoreOf(s, p.id) }))
      .sort((a, b) => b.score.total - a.score.total)
      .map(
        ({ p, score }) => `<tr>
          <td><i class="dot" style="background:${hex(p.color)}"></i> ${p.name}</td>
          <td>${score.citizens}</td><td>${score.buildings}</td><td>${score.bases}</td><td><b>${score.total}</b></td>
        </tr>`,
      )
      .join('');
    return `<div class="sheet">
      <h2>${title}</h2>
      <p>${s.phase.reason}</p>
      <table>
        <thead><tr><th></th><th>Hab.</th><th>Edif.</th><th>Bases</th><th>Puntos</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <button class="primary" data-act="restart">Jugar otra vez</button>
    </div>`;
  }
}
