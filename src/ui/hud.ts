import {
  BIRTH_COST,
  BUILDINGS,
  EXPEDITION_COST,
  EXPEDITION_SETTLERS,
  JOBS,
  JOB_INFO,
  MARKET_LOT,
  MAX_POPULATION,
  RESOURCES,
  RESOURCE_INFO,
  SPECIALTY_BONUS,
  TICKS_PER_SECOND,
  TOTAL_ROUNDS,
  UPGRADES,
  seconds,
} from '../core/config';
import {
  activePlayer,
  alertsFor,
  assignedTotal,
  capacityOf,
  citizensOf,
  hasSource,
  issue,
  missingCost,
  missingFor,
  needsWork,
  populationOf,
  ratesFor,
  reproductionStatus,
  scoreOf,
  siteAvailability,
  storageOf,
  upgradable,
} from '../core/game';
import { canPay, marketPrice, suggestTrade } from '../core/trade';
import type { Base, BuildingType, Command, GameState, Job, Offer, ResourceId, Site, Stock } from '../core/types';
import { patch } from './patch';

export const ME = 0;

const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;
const STAR_LINE = (count: number) => '★'.repeat(count) + '☆'.repeat(5 - count);
const signed = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(Math.round(value))}`;
const clock = (ticks: number) => {
  const total = Math.max(0, Math.ceil(ticks / TICKS_PER_SECOND));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
const BONUS_PERCENT = Math.round((SPECIALTY_BONUS - 1) * 100);
const stepFor = (resource: ResourceId) => (resource === 'iron' || resource === 'gold' ? 1 : 5);

const REPRO_TEXT = {
  idle: 'Asigná 2 o más para tener hijos.',
  running: 'En curso.',
  need_two: 'Hacen falta al menos 2.',
  no_housing: 'Sin vivienda libre: construí una casa.',
  no_supplies: `Falta comida o agua (cada nacimiento usa ${BIRTH_COST.food} y ${BIRTH_COST.water}).`,
  cap: `Llegaste al máximo de ${MAX_POPULATION}.`,
};

type Tab = 'jobs' | 'build' | 'upgrades';

interface TradeForm {
  give: Stock;
  want: Stock;
  to: number | null;
  counterOf: number | null;
}

const emptyForm = (): TradeForm => ({ give: {}, want: {}, to: null, counterOf: null });

export class Hud {
  selectedBase: number | null = null;
  selectedSite: number | null = null;
  /** Base de origen mientras se elige dónde fundar una nueva. */
  expanding: number | null = null;

  private tab: Tab = 'jobs';
  private openResource: ResourceId | null = null;
  private showRanking = false;
  private lastTurnKey = '';
  private nextRender = 0;
  private form = emptyForm();
  private marketGive: ResourceId = 'wood';
  private marketWant: ResourceId = 'stone';

  private top: HTMLElement;
  private panel: HTMLElement;
  private offers: HTMLElement;
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
      <div id="offers"></div>
      <div id="toasts"></div>
      <div id="banner"></div>
      <div id="overlay"></div>`;
    this.top = root.querySelector('#top')!;
    this.panel = root.querySelector('#panel')!;
    this.offers = root.querySelector('#offers')!;
    this.toasts = root.querySelector('#toasts')!;
    this.banner = root.querySelector('#banner')!;
    this.overlay = root.querySelector('#overlay')!;
    root.addEventListener('click', (event) => this.handleClick(event));
    root.addEventListener('change', (event) => this.handleChange(event));
  }

  tapBase(id: number) {
    const base = this.state.bases.find((b) => b.id === id);
    if (!base || this.expanding !== null) return;
    this.selectedBase = base.owner === ME ? id : null;
    this.openResource = null;
    this.render();
  }

  tapSite(id: number) {
    this.selectedSite = id;
    this.render();
  }

  tapEmpty() {
    if (this.expanding === null) this.selectedBase = null;
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

  private send(cmd: Command): boolean {
    const result = issue(this.state, ME, cmd);
    if (!result.ok) this.toast(result.error, 'warn');
    this.render();
    return result.ok;
  }

  private handleChange(event: Event) {
    const element = event.target as HTMLSelectElement;
    if (element.dataset.market === 'give') this.marketGive = element.value as ResourceId;
    if (element.dataset.market === 'want') this.marketWant = element.value as ResourceId;
    this.render();
  }

  private handleClick(event: Event) {
    const element = (event.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!element || element.hasAttribute('disabled')) return;
    const { act, job, delta, type, resource, base, side, offer, to } = element.dataset;
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
      case 'upgrade':
        if (baseId !== null) this.send({ type: 'upgrade', baseId, building: type as BuildingType });
        break;
      case 'expand':
        this.expanding = baseId;
        this.selectedSite = null;
        this.render();
        break;
      case 'cancel-expand':
        this.expanding = null;
        this.selectedSite = null;
        this.render();
        break;
      case 'send-expedition':
        if (this.expanding !== null && this.selectedSite !== null) {
          const sent = this.send({ type: 'foundBase', baseId: this.expanding, siteId: this.selectedSite });
          if (sent) {
            this.expanding = null;
            this.selectedSite = null;
            this.render();
          }
        }
        break;
      case 'end':
        this.expanding = null;
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
      case 'amount': {
        const stock = side === 'give' ? this.form.give : this.form.want;
        const id = resource as ResourceId;
        stock[id] = Math.max(0, (stock[id] ?? 0) + Number(delta));
        this.render();
        break;
      }
      case 'to':
        this.form.to = to === 'all' ? null : Number(to);
        this.render();
        break;
      case 'propose':
        this.submitOffer();
        break;
      case 'clear-form':
        this.form = emptyForm();
        this.render();
        break;
      case 'suggest': {
        const hint = this.suggestion();
        if (hint) {
          this.form = { ...emptyForm(), give: hint.give, want: hint.want };
          this.render();
        }
        break;
      }
      case 'market':
        this.send({ type: 'market', give: this.marketGive, want: this.marketWant });
        break;
      case 'accept':
        this.send({ type: 'respond', offerId: Number(offer), accept: true });
        break;
      case 'reject':
        this.send({ type: 'respond', offerId: Number(offer), accept: false });
        break;
      case 'counter': {
        const original = this.state.offers.find((o) => o.id === Number(offer));
        if (original) {
          this.form = { give: { ...original.want }, want: { ...original.give }, to: original.from, counterOf: original.id };
          this.selectedBase = null;
          this.render();
        }
        break;
      }
    }
  }

  private submitOffer() {
    const { give, want, to, counterOf } = this.form;
    const sent =
      counterOf !== null
        ? this.send({ type: 'counter', offerId: counterOf, give, want })
        : this.send({ type: 'propose', to, give, want });
    if (sent) {
      this.form = emptyForm();
      this.render();
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
    if (s.phase.kind !== 'decisions') this.expanding = null;
    if (this.form.counterOf !== null && !this.pendingOffers(s).some((o) => o.id === this.form.counterOf)) {
      this.form = emptyForm();
    }
    patch(this.top, this.topHtml(s));
    patch(this.panel, this.panelHtml(s));
    this.panel.className = this.panel.childElementCount > 0 ? 'open' : '';
    patch(this.offers, this.offersHtml(s));
    patch(this.overlay, s.phase.kind === 'over' ? this.overHtml(s) : '');
  }

  private showBanner(text: string) {
    this.banner.textContent = text;
    this.banner.classList.remove('show');
    void this.banner.offsetWidth;
    this.banner.classList.add('show');
  }

  private announceTurn(s: GameState) {
    const active = activePlayer(s);
    const key = `${s.phase.kind}:${active}:${s.round}`;
    if (key === this.lastTurnKey) return;
    this.lastTurnKey = key;
    if (active !== ME) return;
    if (s.phase.kind === 'decisions') {
      this.showBanner('¡Es tu turno!');
      if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(60);
    } else if (s.phase.kind === 'trade') {
      this.form = emptyForm();
      this.showBanner('Fase de comercio');
    }
  }

  private topHtml(s: GameState) {
    const active = activePlayer(s);
    const phase = s.phase;
    const player = active !== null ? s.players[active] : null;
    const label =
      phase.kind === 'draft'
        ? 'ELIGE BASE'
        : phase.kind === 'decisions'
          ? 'DECISIONES'
          : phase.kind === 'trade'
            ? 'COMERCIO'
            : 'FIN';
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
      const tone = stock >= cap ? ' full' : stock <= 0 && net <= 0 && rates[resource].consumption > 0 ? ' empty' : net < -0.5 ? ' down' : '';
      return `<button class="chip${tone}" data-act="resource" data-resource="${resource}" aria-label="${info.name}">
        <span class="chip-icon">${info.icon}</span>
        <span class="chip-text"><b>${stock}</b><small>${signed(net)}/min</small></span>
      </button>`;
    }).join('');

    const canEnd = (phase.kind === 'decisions' || phase.kind === 'trade') && active === ME;
    const endButton = `<button class="end" data-act="end" ${canEnd ? '' : 'disabled'}>Finalizar fase</button>`;

    return `
      <div class="bar">${turn}<div class="chips">${chips}</div>${endButton}</div>
      ${this.hintHtml(s)}
      ${this.alertsHtml(s)}
      ${this.openResource ? this.resourceHtml(s, this.openResource) : ''}
      ${this.showRanking ? this.rankingHtml(s) : ''}`;
  }

  private alertsHtml(s: GameState) {
    if (s.phase.kind === 'draft' || s.phase.kind === 'over') return '';
    const alerts = alertsFor(s, ME).slice(0, 3);
    if (alerts.length === 0) return '';
    return `<div class="alerts">${alerts
      .map((alert) => `<span class="alert ${alert.level}">⚠ ${alert.text}</span>`)
      .join('')}</div>`;
  }

  private nextPlayer(s: GameState): number | null {
    const phase = s.phase;
    if (phase.kind === 'draft') return phase.order[phase.index + 1] ?? 0;
    if (phase.kind !== 'decisions' && phase.kind !== 'trade') return null;
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
    } else if (this.expanding !== null) {
      text = 'Tocá un círculo del mapa para elegir el destino.';
    } else if (s.phase.kind === 'decisions' && s.round === 1 && active === ME && this.selectedBase === null) {
      const assigned = s.bases.some((b) => b.owner === ME && assignedTotal(b) > 0);
      text = assigned
        ? 'Tocá tu otra base y dale trabajo también. Después finalizá la fase.'
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
    if (this.expanding !== null) return this.expansionHtml(s);
    const trading = s.phase.kind === 'trade' && activePlayer(s) === ME;
    if (trading || this.form.counterOf !== null) return this.tradeHtml(s);
    if (this.selectedBase === null) return '';
    const base = s.bases.find((b) => b.id === this.selectedBase);
    return base ? this.baseHtml(s, base) : '';
  }

  private siteInfoHtml(s: GameState, site: Site) {
    const stars = RESOURCES.map(
      (resource) => `<div class="star-row">
        <span>${RESOURCE_INFO[resource].icon} ${RESOURCE_INFO[resource].name}</span>
        <b class="stars">${STAR_LINE(site.stars[resource])}</b>
      </div>`,
    ).join('');
    const problem = siteAvailability(s, site);
    return `${stars}
      <p class="note good">Ventaja: ${site.advantage}</p>
      <p class="note bad">Desventaja: ${site.disadvantage}</p>
      <p class="note">${this.specialtyText(site)}</p>
      ${problem ? `<p class="note bad">${problem}</p>` : ''}`;
  }

  private specialtyText(site: Site) {
    const names = site.specialty.map((job) => JOB_INFO[job].name.toLowerCase()).join(' y ');
    return `Especialidad: ${names} +${BONUS_PERCENT} %.`;
  }

  private siteHtml(s: GameState, site: Site) {
    const myTurn = activePlayer(s) === ME;
    return `<header><h3>${site.name}</h3></header>
      <div class="body">
        ${this.siteInfoHtml(s, site)}
        <button class="primary" data-act="found" ${siteAvailability(s, site) || !myTurn ? 'disabled' : ''}>
          ${myTurn ? 'Fundar base aquí' : 'Esperá tu turno'}
        </button>
      </div>`;
  }

  private expansionHtml(s: GameState) {
    const site = this.selectedSite !== null ? s.map.sites[this.selectedSite] : null;
    const origin = s.bases.find((b) => b.id === this.expanding);
    const body = site
      ? `${this.siteInfoHtml(s, site)}
         <button class="primary" data-act="send-expedition" ${siteAvailability(s, site) ? 'disabled' : ''}>
           Enviar ${EXPEDITION_SETTLERS} ciudadanos
         </button>`
      : `<p class="note">Salen ${EXPEDITION_SETTLERS} ciudadanos desde ${origin?.name ?? 'tu base'}. Tardan en llegar según la distancia.</p>`;
    return `<header>
        <h3>${site ? site.name : 'Nueva base'}</h3>
        <button class="x" data-act="cancel-expand" aria-label="Cancelar">✕</button>
      </header>
      <div class="body">${body}</div>`;
  }

  private baseHtml(s: GameState, base: Base) {
    const population = citizensOf(s, base.id).length;
    const capacity = capacityOf(s, base);
    const free = population - assignedTotal(base);
    const myTurn = activePlayer(s) === ME && s.phase.kind === 'decisions';
    const labels: Record<Tab, string> = { jobs: 'Trabajos', build: 'Construir', upgrades: 'Mejoras' };
    const tabs = (['jobs', 'build', 'upgrades'] as Tab[])
      .map(
        (tab) =>
          `<button class="tab${this.tab === tab ? ' on' : ''}" data-act="tab" data-tab="${tab}">${labels[tab]}</button>`,
      )
      .join('');
    const content =
      this.tab === 'jobs'
        ? this.jobsHtml(s, base, free, myTurn)
        : this.tab === 'build'
          ? this.buildHtml(s, base, myTurn)
          : this.upgradesHtml(s, base, myTurn);
    return `<header>
        <h3>${base.name}</h3>
        <button class="x" data-act="close" aria-label="Cerrar">✕</button>
      </header>
      <div class="stats">
        <span>Población <b>${population} / ${capacity}</b></span>
        <span>Libres <b>${free}</b></span>
      </div>
      <div class="specialty">${this.specialtyText(s.map.sites[base.siteId])}</div>
      ${myTurn ? '' : '<div class="wait">Tus órdenes siguen en marcha. Esperá tu turno para cambiarlas.</div>'}
      <div class="tabs">${tabs}</div>
      <div class="body">${content}</div>`;
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

  private costsHtml(s: GameState, cost: Stock) {
    const player = s.players[ME];
    return RESOURCES.filter((r) => cost[r])
      .map((r) => {
        const have = Math.floor(player.stock[r]);
        const need = cost[r]!;
        return `<span class="${have < need ? 'lack' : ''}">${RESOURCE_INFO[r].icon} ${have} / ${need}</span>`;
      })
      .join('');
  }

  private lackText(s: GameState, cost: Stock) {
    return missingCost(s.players[ME], cost)
      .map((m) => `${m.amount} de ${RESOURCE_INFO[m.resource].name.toLowerCase()}`)
      .join(' y ');
  }

  private buildHtml(s: GameState, base: Base, myTurn: boolean) {
    const player = s.players[ME];
    const pending = s.buildings.filter((b) => b.baseId === base.id && needsWork(b));
    const travelling = s.expeditions
      .filter((e) => e.owner === ME)
      .map((e) => `<span>🚶 Expedición a ${s.map.sites[e.siteId].name}</span>`)
      .join('');
    const queue =
      pending.length || travelling
        ? `<div class="queue">${pending
            .map((b) => {
              const name = b.upgrading ? UPGRADES[b.type].name : BUILDINGS[b.type].name;
              return `<span>${BUILDINGS[b.type].icon} ${name} ${Math.floor((b.progress / b.required) * 100)}%</span>`;
            })
            .join('')}${travelling}${pending.length && base.effective.build === 0 ? '<small class="warn">Sin constructores asignados</small>' : ''}</div>`
        : '';
    const cards = (Object.keys(BUILDINGS) as BuildingType[])
      .map((type) => {
        const info = BUILDINGS[type];
        const lack = missingFor(player, type)
          .map((m) => `${m.amount} de ${RESOURCE_INFO[m.resource].name.toLowerCase()}`)
          .join(' y ');
        return `<div class="card">
          <div class="card-head"><b>${info.icon} ${info.name}</b><small>${info.seconds} s</small></div>
          <p>${info.effect}</p>
          <div class="costs">${this.costsHtml(s, info.cost)}</div>
          ${lack ? `<small class="lack">Faltan ${lack}.</small>` : ''}
          <button class="primary" data-act="build" data-type="${type}" ${myTurn && !lack ? '' : 'disabled'}>Construir</button>
        </div>`;
      })
      .join('');
    const lack = this.lackText(s, EXPEDITION_COST);
    const people = citizensOf(s, base.id).length;
    const tooFew = people <= EXPEDITION_SETTLERS;
    const expansion = `<div class="card">
      <div class="card-head"><b>🚩 Nueva base</b><small>${EXPEDITION_SETTLERS} ciudadanos</small></div>
      <p>Una expedición sale de esta base hacia otra región</p>
      <div class="costs">${this.costsHtml(s, EXPEDITION_COST)}</div>
      ${lack ? `<small class="lack">Faltan ${lack}.</small>` : ''}
      ${tooFew ? `<small class="lack">Hacen falta más de ${EXPEDITION_SETTLERS} ciudadanos aquí.</small>` : ''}
      <button class="primary" data-act="expand" ${myTurn && !lack && !tooFew ? '' : 'disabled'}>Elegir lugar</button>
    </div>`;
    return `${queue}${cards}${expansion}`;
  }

  private upgradesHtml(s: GameState, base: Base, myTurn: boolean) {
    const types = (Object.keys(BUILDINGS) as BuildingType[]).filter((type) =>
      s.buildings.some((b) => b.baseId === base.id && b.type === type && b.done),
    );
    if (types.length === 0) return '<p class="note">Construí edificios en esta base para poder mejorarlos.</p>';
    return types
      .map((type) => {
        const info = UPGRADES[type];
        const ready = upgradable(s, base, type).length;
        const lack = this.lackText(s, info.cost);
        return `<div class="card">
          <div class="card-head"><b>${BUILDINGS[type].icon} ${info.name}</b><small>${info.seconds} s</small></div>
          <p>${info.effect}</p>
          <div class="costs">${this.costsHtml(s, info.cost)}</div>
          ${lack ? `<small class="lack">Faltan ${lack}.</small>` : ''}
          <button class="primary" data-act="upgrade" data-type="${type}" ${myTurn && !lack && ready > 0 ? '' : 'disabled'}>
            ${ready > 0 ? `Mejorar (${ready} disponible${ready > 1 ? 's' : ''})` : 'Sin edificios por mejorar'}
          </button>
        </div>`;
      })
      .join('');
  }

  // ---- Comercio ------------------------------------------------------------

  private pendingOffers(s: GameState): Offer[] {
    return s.offers.filter((o) => o.status === 'open' && o.responses[ME] === 'pending');
  }

  private suggestion() {
    const goals = [
      ...(Object.keys(BUILDINGS) as BuildingType[]).map((type) => ({ name: `una ${BUILDINGS[type].name.toLowerCase()}`, cost: BUILDINGS[type].cost })),
      { name: 'una nueva base', cost: EXPEDITION_COST },
    ];
    return suggestTrade(this.state, ME, goals);
  }

  private stockHtml(stock: Stock) {
    return RESOURCES.filter((r) => stock[r])
      .map((r) => `<span class="big">${RESOURCE_INFO[r].icon} <b>${stock[r]}</b></span>`)
      .join('');
  }

  private offersHtml(s: GameState) {
    return this.pendingOffers(s)
      .filter((offer) => offer.id !== this.form.counterOf)
      .slice(0, 2)
      .map((offer) => {
        const seller = s.players[offer.from];
        const canAccept = canPay(s.players[ME], offer.want);
        return `<div class="offer" style="--pc:${hex(seller.color)}">
          <div class="offer-head">${seller.name} ${offer.counterOf !== null ? 'contraoferta' : 'propone'}</div>
          <div class="offer-deal">
            <div><small>Te da</small>${this.stockHtml(offer.give)}</div>
            <span class="arrow">⇄</span>
            <div><small>Te pide</small>${this.stockHtml(offer.want)}</div>
          </div>
          <div class="offer-actions">
            <button class="ok" data-act="accept" data-offer="${offer.id}" ${canAccept ? '' : 'disabled'}>Aceptar</button>
            <button class="no" data-act="reject" data-offer="${offer.id}">Rechazar</button>
            <button class="alt" data-act="counter" data-offer="${offer.id}">Contraoferta</button>
          </div>
        </div>`;
      })
      .join('');
  }

  private amountHtml(side: 'give' | 'want', resource: ResourceId, value: number, canAdd: boolean) {
    const step = stepFor(resource);
    return `<span class="amount">
      <button class="mini" data-act="amount" data-side="${side}" data-resource="${resource}" data-delta="${-step}" ${value > 0 ? '' : 'disabled'} aria-label="Menos">−</button>
      <b>${value}</b>
      <button class="mini" data-act="amount" data-side="${side}" data-resource="${resource}" data-delta="${step}" ${canAdd ? '' : 'disabled'} aria-label="Más">+</button>
    </span>`;
  }

  private tradeHtml(s: GameState) {
    const player = s.players[ME];
    const { give, want, to, counterOf } = this.form;
    const rows = RESOURCES.map((resource) => {
      const offered = give[resource] ?? 0;
      const canAdd = offered + stepFor(resource) <= Math.floor(player.stock[resource]);
      return `<div class="trade-row">
        ${this.amountHtml('give', resource, offered, canAdd)}
        <span class="trade-icon">${RESOURCE_INFO[resource].icon}</span>
        ${this.amountHtml('want', resource, want[resource] ?? 0, true)}
      </div>`;
    }).join('');

    const options = s.players.filter((p) => p.id !== ME && p.alive);
    const targets =
      counterOf !== null
        ? ''
        : `<div class="targets">
            <button class="target${to === null ? ' on' : ''}" data-act="to" data-to="all">Todos</button>
            ${options
              .map((p) => `<button class="target${to === p.id ? ' on' : ''}" data-act="to" data-to="${p.id}"><i class="dot" style="background:${hex(p.color)}"></i> ${p.name}</button>`)
              .join('')}
          </div>`;

    const hint = counterOf === null ? this.suggestion() : null;
    const sent = s.offers
      .filter((o) => o.from === ME)
      .map((o) => {
        const state = o.status === 'accepted' ? 'Aceptada' : o.status === 'rejected' ? 'Rechazada' : 'Esperando…';
        return `<div class="sent"><span>${this.stockHtml(o.give)} ⇄ ${this.stockHtml(o.want)}</span><small>${state}</small></div>`;
      })
      .join('');

    const empty = RESOURCES.every((r) => !give[r]) || RESOURCES.every((r) => !want[r]);
    const select = (side: 'give' | 'want', current: ResourceId) =>
      `<select data-market="${side}" aria-label="${side === 'give' ? 'Entregás' : 'Recibís'}">${RESOURCES.map(
        (r) => `<option value="${r}" ${r === current ? 'selected' : ''}>${RESOURCE_INFO[r].icon} ${RESOURCE_INFO[r].name}</option>`,
      ).join('')}</select>`;
    const same = this.marketGive === this.marketWant;
    const price = marketPrice(this.marketGive, this.marketWant);
    const market =
      counterOf !== null
        ? ''
        : `<h4>Mercado neutral</h4>
          <div class="market">
            ${select('give', this.marketGive)}<span>→</span>${select('want', this.marketWant)}
          </div>
          <button class="secondary" data-act="market" ${same || Math.floor(player.stock[this.marketGive]) < price ? 'disabled' : ''}>
            ${same ? 'Elegí dos recursos distintos' : `Cambiar ${price} por ${MARKET_LOT}`}
          </button>`;

    return `<header><h3>${counterOf !== null ? 'Contraoferta' : 'Comercio'}</h3></header>
      <div class="body">
        <div class="trade-head"><span>OFREZCO</span><span>QUIERO</span></div>
        ${rows}
        ${targets}
        ${hint ? `<button class="tip" data-act="suggest">💡 ${hint.text}</button>` : ''}
        <button class="primary" data-act="propose" ${empty ? 'disabled' : ''}>${counterOf !== null ? 'Enviar contraoferta' : 'Proponer'}</button>
        ${sent}
        ${market}
      </div>`;
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
