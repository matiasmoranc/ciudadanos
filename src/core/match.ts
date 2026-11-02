import { playBotTurn, stepBotTrade } from './bot';
import { autoPick, tick } from './game';
import type { GameState } from './types';

/** Un paso del reloj central: simulación más bots. Es lo que correría un servidor. */
export function stepMatch(s: GameState) {
  tick(s);
  const phase = s.phase;
  if (phase.kind === 'draft') {
    if (s.players[phase.order[phase.index]].isBot && s.tick >= phase.botActAt) autoPick(s);
  } else if (phase.kind === 'decisions') {
    if (s.players[phase.player].isBot && s.tick >= phase.botActAt) playBotTurn(s, phase.player);
  } else if (phase.kind === 'trade') {
    stepBotTrade(s);
  }
}
