import { MARKET_LOT, MARKET_SPREAD, MARKET_VALUE, RESOURCES, RESOURCE_INFO, seconds } from './config';
import { activePlayer, gain, random, say } from './game';
import type { CommandResult, GameState, Offer, Player, ResourceId, Stock } from './types';

const MAX_OPEN_OFFERS = 3;

function clean(stock: Stock): Stock {
  const result: Stock = {};
  for (const resource of RESOURCES) {
    const amount = Math.floor(stock[resource] ?? 0);
    if (amount > 0) result[resource] = amount;
  }
  return result;
}

const isEmpty = (stock: Stock) => Object.keys(stock).length === 0;

export const canPay = (player: Player, stock: Stock) =>
  RESOURCES.every((resource) => Math.floor(player.stock[resource]) >= (stock[resource] ?? 0));

export function stockText(stock: Stock): string {
  return RESOURCES.filter((resource) => stock[resource])
    .map((resource) => `${stock[resource]} de ${RESOURCE_INFO[resource].name.toLowerCase()}`)
    .join(' y ');
}

function createOffer(s: GameState, from: number, to: number | null, give: Stock, want: Stock, counterOf: number | null) {
  const responses: Offer['responses'] = {};
  for (const player of s.players) {
    if (player.id !== from && player.alive && (to === null || to === player.id)) responses[player.id] = 'pending';
  }
  const offer: Offer = {
    id: s.nextId++,
    from,
    to,
    give,
    want,
    status: 'open',
    responses,
    acceptedBy: null,
    counterOf,
    respondAt: s.tick + seconds(1 + random(s) * 2),
  };
  s.offers.push(offer);
  return offer;
}

export function propose(s: GameState, player: number, to: number | null, give: Stock, want: Stock): CommandResult {
  const offered = clean(give);
  const asked = clean(want);
  if (isEmpty(offered) || isEmpty(asked)) return { ok: false, error: 'Elegí qué ofrecés y qué querés.' };
  if (!canPay(s.players[player], offered)) return { ok: false, error: 'No tenés esos recursos para ofrecer.' };
  if (to !== null && (to === player || !s.players[to]?.alive)) return { ok: false, error: 'Ese jugador no puede recibir ofertas.' };
  const open = s.offers.filter((o) => o.from === player && o.status === 'open').length;
  if (open >= MAX_OPEN_OFFERS) return { ok: false, error: 'Esperá respuesta de tus ofertas abiertas.' };
  createOffer(s, player, to, offered, asked, null);
  return { ok: true };
}

function findPending(s: GameState, player: number, offerId: number): Offer | null {
  const offer = s.offers.find((o) => o.id === offerId);
  return offer?.status === 'open' && offer.responses[player] === 'pending' ? offer : null;
}

function reject(s: GameState, offer: Offer, player: number) {
  offer.responses[player] = 'rejected';
  if (Object.values(offer.responses).every((answer) => answer === 'rejected')) offer.status = 'rejected';
  say(s, offer.from, `${s.players[player].name} rechazó tu oferta.`, 'info');
}

export function respond(s: GameState, player: number, offerId: number, accept: boolean): CommandResult {
  if (s.phase.kind !== 'trade') return { ok: false, error: 'La fase de comercio terminó.' };
  const offer = findPending(s, player, offerId);
  if (!offer) return { ok: false, error: 'Esa oferta ya no está disponible.' };
  if (!accept) {
    reject(s, offer, player);
    return { ok: true };
  }
  const seller = s.players[offer.from];
  const buyer = s.players[player];
  if (!canPay(seller, offer.give)) return { ok: false, error: `${seller.name} ya no tiene esos recursos.` };
  if (!canPay(buyer, offer.want)) return { ok: false, error: 'No tenés los recursos que te piden.' };

  for (const resource of RESOURCES) {
    seller.stock[resource] -= offer.give[resource] ?? 0;
    buyer.stock[resource] -= offer.want[resource] ?? 0;
  }
  for (const resource of RESOURCES) {
    gain(s, buyer, resource, offer.give[resource] ?? 0);
    gain(s, seller, resource, offer.want[resource] ?? 0);
  }
  offer.status = 'accepted';
  offer.acceptedBy = player;
  say(s, seller.id, `${buyer.name} aceptó: recibís ${stockText(offer.want)}.`, 'good');
  say(s, buyer.id, `Trato hecho: recibís ${stockText(offer.give)}.`, 'good');
  return { ok: true };
}

export function counter(s: GameState, player: number, offerId: number, give: Stock, want: Stock): CommandResult {
  if (s.phase.kind !== 'trade') return { ok: false, error: 'La fase de comercio terminó.' };
  const offer = findPending(s, player, offerId);
  if (!offer) return { ok: false, error: 'Esa oferta ya no está disponible.' };
  const offered = clean(give);
  const asked = clean(want);
  if (isEmpty(offered) || isEmpty(asked)) return { ok: false, error: 'Elegí qué ofrecés y qué querés.' };
  if (!canPay(s.players[player], offered)) return { ok: false, error: 'No tenés esos recursos para ofrecer.' };
  reject(s, offer, player);
  createOffer(s, player, offer.from, offered, asked, offer.id);
  return { ok: true };
}

/** Cuánto hay que entregar por un lote: el mercado siempre paga peor que un jugador. */
export function marketPrice(give: ResourceId, want: ResourceId): number {
  return Math.ceil((MARKET_LOT * MARKET_VALUE[want] * MARKET_SPREAD) / MARKET_VALUE[give]);
}

export function market(s: GameState, player: number, give: ResourceId, want: ResourceId): CommandResult {
  if (give === want) return { ok: false, error: 'Elegí dos recursos distintos.' };
  const owner = s.players[player];
  const price = marketPrice(give, want);
  if (Math.floor(owner.stock[give]) < price) {
    return { ok: false, error: `Necesitás ${price} de ${RESOURCE_INFO[give].name.toLowerCase()}.` };
  }
  owner.stock[give] -= price;
  gain(s, owner, want, MARKET_LOT);
  return { ok: true };
}

/** Sugiere un intercambio según lo que le falta al jugador para su próxima obra. */
export function suggestTrade(
  s: GameState,
  player: number,
  goals: { name: string; cost: Stock }[],
): { text: string; give: Stock; want: Stock } | null {
  if (activePlayer(s) !== player) return null;
  const owner = s.players[player];
  for (const goal of goals) {
    const lacking = RESOURCES.find((r) => (goal.cost[r] ?? 0) > Math.floor(owner.stock[r]));
    if (!lacking) continue;
    const need = (goal.cost[lacking] ?? 0) - Math.floor(owner.stock[lacking]);
    const spare = RESOURCES.filter((r) => r !== lacking && !goal.cost[r] && r !== 'food' && r !== 'water').sort(
      (a, b) => owner.stock[b] * MARKET_VALUE[b] - owner.stock[a] * MARKET_VALUE[a],
    )[0];
    if (!spare) continue;
    const amount = Math.ceil((need * MARKET_VALUE[lacking]) / MARKET_VALUE[spare]) * 2;
    if (owner.stock[spare] < amount) continue;
    return {
      text: `Te faltan ${need} de ${RESOURCE_INFO[lacking].name.toLowerCase()} para ${goal.name}. ¿Querés ofrecer ${amount} de ${RESOURCE_INFO[spare].name.toLowerCase()}?`,
      give: { [spare]: amount },
      want: { [lacking]: need },
    };
  }
  return null;
}
