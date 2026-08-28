import type { Quote } from '../types';

const BASE =
  'https://open.bymadata.com.ar/vanoms-be-core/rest/api/bymadata/free';

/**
 * Paneles de BYMA que usamos.
 *
 * `lebacs` no está documentado públicamente pero es el único panel que trae
 * las LECAPs (S*). `public-bonds` trae los BONCAPs (T*) pero NO las LECAPs,
 * así que hacen falta los dos para cubrir la curva de tasa fija.
 */
export type BymaPanel = 'lebacs' | 'public-bonds';

/** settlementType "2" = 24hs (T+1). Es el plazo de referencia del mercado. */
const SETTLEMENT_T1 = '2';

interface BymaPanelItem {
  symbol: string;
  settlementType: string;
  denominationCcy: string;
  maturityDate: string | null;
  trade: number | null;
  closingPrice: number | null;
  previousClosingPrice: number | null;
  openingPrice: number | null;
  tradingHighPrice: number | null;
  tradingLowPrice: number | null;
  vwap: number | null;
  bidPrice: number | null;
  offerPrice: number | null;
  quantityBid: number | null;
  quantityOffer: number | null;
  volume: number | null;
  volumeAmount: number | null;
  numberOfOrders: number | null;
  tradeHour: string | null;
}

export interface BymaFicha {
  symbol: string;
  denominacion: string;
  moneda: string;
  fechaEmision: string;
  fechaVencimiento: string;
  formaAmortizacion: string;
  interes: string;
  codigoIsin: string;
  emisor: string;
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`BYMA ${path} respondió ${res.status}`);
  return res.json() as Promise<T>;
}

/** Trae un panel completo. `page` es ignorado por la API: hay que usar page_size. */
async function fetchPanel(panel: BymaPanel, signal?: AbortSignal): Promise<BymaPanelItem[]> {
  const payload = await postJson<{ data?: BymaPanelItem[] } | BymaPanelItem[]>(
    panel,
    { page_size: 5000 },
    signal,
  );
  return Array.isArray(payload) ? payload : (payload.data ?? []);
}

function zeroToNull(value: number | null | undefined): number | null {
  return value === null || value === undefined || value === 0 ? null : value;
}

function normalize(item: BymaPanelItem): Quote {
  return {
    symbol: item.symbol,
    // BYMA repite el último trade en `trade` y `closingPrice` durante la
    // rueda. Si no operó, ambos vienen en 0.
    last: zeroToNull(item.trade) ?? zeroToNull(item.closingPrice),
    previousClose: zeroToNull(item.previousClosingPrice),
    open: zeroToNull(item.openingPrice),
    high: zeroToNull(item.tradingHighPrice),
    low: zeroToNull(item.tradingLowPrice),
    vwap: zeroToNull(item.vwap),
    bid: zeroToNull(item.bidPrice),
    ask: zeroToNull(item.offerPrice),
    bidSize: zeroToNull(item.quantityBid),
    askSize: zeroToNull(item.quantityOffer),
    volumeNominal: item.volume ?? null,
    volumeAmount: item.volumeAmount ?? null,
    orderCount: item.numberOfOrders ?? null,
    lastTradeTime: item.tradeHour || null,
    currency: item.denominationCcy,
    maturityDate: item.maturityDate ? item.maturityDate.slice(0, 10) : null,
    source: 'byma',
  };
}

/**
 * Devuelve las cotizaciones T+1 en ARS de los paneles pedidos, indexadas por
 * ticker. Si el mismo ticker aparece en más de un panel gana el primero.
 */
export async function fetchQuotes(
  panels: readonly BymaPanel[],
  signal?: AbortSignal,
): Promise<Map<string, Quote>> {
  const panelResults = await Promise.all(panels.map((p) => fetchPanel(p, signal)));
  const quotes = new Map<string, Quote>();
  for (const items of panelResults) {
    for (const item of items) {
      if (item.settlementType !== SETTLEMENT_T1) continue;
      if (item.denominationCcy !== 'ARS') continue;
      if (!quotes.has(item.symbol)) quotes.set(item.symbol, normalize(item));
    }
  }
  return quotes;
}

/**
 * Ficha técnica de un instrumento. Es la fuente autoritativa para clasificar
 * el universo (moneda, forma de amortización, esquema de intereses) y para
 * la TEM de emisión. Se usa offline desde scripts/refresh-reference.ts,
 * no en el path del request: es lenta y los datos son estáticos.
 */
export async function fetchFicha(
  symbol: string,
  signal?: AbortSignal,
): Promise<BymaFicha | null> {
  const payload = await postJson<{ data?: BymaFicha[] }>(
    'bnown/fichatecnica/especies/general',
    { symbol },
    signal,
  );
  const row = payload.data?.[0];
  return row ? { ...row, symbol } : null;
}
