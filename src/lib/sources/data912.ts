import type { Quote } from '../types';

const BASE = 'https://data912.com';

/**
 * Endpoints live de data912. El universo de tasa fija está partido: las
 * LECAPs viven en `arg_notes` y los BONCAPs en `arg_bonds`.
 */
export type Data912Feed = 'arg_notes' | 'arg_bonds';

interface Data912Item {
  symbol: string;
  q_bid: number;
  px_bid: number;
  px_ask: number;
  q_ask: number;
  /** Monto efectivo negociado. */
  v: number;
  /** Cantidad de operaciones. */
  q_op: number;
  /** Último precio. */
  c: number;
  pct_change: number;
}

/**
 * Fuente de respaldo. Verificado contra BYMA: los 217 símbolos de data912 son
 * un subconjunto exacto de los T+1 de BYMA con valores idénticos, o sea que
 * es un espejo.
 *
 * Limitaciones frente a BYMA, que hay que compensar del lado nuestro:
 *  - no informa fecha de vencimiento -> sale de la tabla de referencia;
 *  - no informa cierre anterior en absoluto, solo la variación porcentual
 *    -> lo reconstruimos como c / (1 + pct/100);
 *  - no informa hora del último trade -> el timestamp queda en null.
 */
export async function fetchQuotes(
  feeds: readonly Data912Feed[],
  signal?: AbortSignal,
): Promise<Map<string, Quote>> {
  const results = await Promise.all(
    feeds.map(async (feed) => {
      const res = await fetch(`${BASE}/live/${feed}`, { signal, cache: 'no-store' });
      if (!res.ok) throw new Error(`data912 ${feed} respondió ${res.status}`);
      return res.json() as Promise<Data912Item[]>;
    }),
  );

  const quotes = new Map<string, Quote>();
  for (const items of results) {
    for (const item of items) {
      if (quotes.has(item.symbol)) continue;
      const last = item.c || null;
      const previousClose =
        last !== null && item.pct_change !== -100
          ? last / (1 + item.pct_change / 100)
          : null;
      quotes.set(item.symbol, {
        symbol: item.symbol,
        last,
        previousClose,
        open: null,
        high: null,
        low: null,
        vwap: null,
        bid: item.px_bid || null,
        ask: item.px_ask || null,
        bidSize: item.q_bid || null,
        askSize: item.q_ask || null,
        volumeNominal: null,
        volumeAmount: item.v ?? null,
        orderCount: item.q_op ?? null,
        lastTradeTime: null,
        currency: 'ARS',
        maturityDate: null,
        source: 'data912',
      });
    }
  }
  return quotes;
}
