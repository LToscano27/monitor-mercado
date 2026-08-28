import type { Quote } from '../types';
import { memo } from '../cache';

/** Identificarse es de buena educación con una API pública sin key. */
const USER_AGENT = 'monitor-mercado/1.0 (+https://github.com/LToscano27/monitor-mercado)';

/** Los paneles refrescan cada ~20s en origen; pedirlos más seguido es castigar. */
const TTL_PANEL_MS = 15_000;
/** Un cierre ya no cambia. Se retiene largo y se revisa cada tanto por si hay rueda nueva. */
const TTL_CIERRE_MS = 15 * 60_000;

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

/**
 * Plazos de liquidación de BYMA.
 *
 * 24hs es el de referencia del mercado y el que se usa siempre que exista.
 * Contado inmediato es la excepción necesaria: un papel a pocos días de vencer
 * deja de tener rueda a 24hs —liquidaría en el vencimiento o después— y pasa a
 * operarse solo en contado. Si se filtra por 24hs a secas, ese papel
 * desaparece de la curva justo cuando sigue operando con volumen.
 */
const SETTLEMENT_T1 = '2';
const SETTLEMENT_CONTADO = '1';

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
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
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
    settlement: item.settlementType === SETTLEMENT_CONTADO ? 'contado' : 'T+1',
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
 * Cotizaciones en ARS de los paneles pedidos, indexadas por ticker.
 *
 * Para cada especie se prefiere la rueda de 24hs; si no tiene, se toma la de
 * contado y la cotización queda marcada como tal, para que el cálculo cuente
 * los días desde la fecha correcta.
 */
export async function fetchQuotes(
  panels: readonly BymaPanel[],
  signal?: AbortSignal,
): Promise<Map<string, Quote>> {
  const panelResults = await Promise.all(
    panels.map((p) => memo(`panel:${p}`, TTL_PANEL_MS, () => fetchPanel(p, signal))),
  );

  const quotes = new Map<string, Quote>();
  for (const items of panelResults) {
    for (const item of items) {
      if (item.denominationCcy !== 'ARS') continue;
      if (item.settlementType !== SETTLEMENT_T1 && item.settlementType !== SETTLEMENT_CONTADO) {
        continue;
      }
      const previa = quotes.get(item.symbol);
      // Sólo el contado cede ante el 24hs; nunca al revés.
      if (previa && !(previa.settlement === 'contado' && item.settlementType === SETTLEMENT_T1)) {
        continue;
      }
      quotes.set(item.symbol, normalize(item));
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

// ─── Serie histórica: los datos de cierre ────────────────────────────────

interface BymaSerie {
  s: 'ok' | 'no_data' | 'error';
  t?: number[];
  c?: number[];
  v?: number[];
}

export interface Cierre {
  /** Fecha de la rueda, 'YYYY-MM-DD'. */
  date: string;
  close: number;
  /** Volumen nominal negociado en esa rueda. */
  volume: number | null;
}

/** Los históricos exigen el sufijo ' 24HS'. Sin él la API responde 400. */
const SUFIJO_24HS = ' 24HS';

const REQUEST_TIMEOUT_MS = 7_000;

/**
 * Un fallo de red transitorio no puede hacer desaparecer un instrumento de la
 * curva. Se reintenta una vez antes de darlo por perdido; si igual falla, el
 * instrumento sale marcado y el lector se entera.
 */
async function conReintento<T>(fn: () => Promise<T>, alFallar: T): Promise<T> {
  try {
    return await fn();
  } catch {
    await new Promise((r) => setTimeout(r, 400));
  }
  try {
    return await fn();
  } catch {
    return alFallar;
  }
}

/**
 * Últimas ruedas de un instrumento. Es la fuente de los datos de cierre:
 * cuando el mercado está cerrado, BYMA cerotea el panel en vivo pero la serie
 * histórica sigue teniendo el cierre real de la última rueda.
 */
export async function fetchHistory(
  symbol: string,
  dias = 20,
  signal?: AbortSignal,
): Promise<Cierre[]> {
  const hasta = Math.floor(Date.now() / 1000);
  const desde = hasta - dias * 86_400;
  const query = new URLSearchParams({
    symbol: `${symbol}${SUFIJO_24HS}`,
    resolution: 'D',
    from: String(desde),
    to: String(hasta),
  });

  // Timeout propio por pedido: un instrumento lento no puede arrastrar al lote.
  const res = await fetch(`${BASE}/chart/historical-series/history?${query}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`BYMA histórico ${symbol} respondió ${res.status}`);

  const serie = (await res.json()) as BymaSerie;
  if (serie.s !== 'ok' || !serie.t?.length || !serie.c?.length) return [];

  return serie.t.map((ts, i) => ({
    date: new Date(ts * 1000).toISOString().slice(0, 10),
    close: serie.c![i],
    volume: serie.v?.[i] ?? null,
  }));
}

/**
 * Cotizaciones de cierre para un conjunto de tickers.
 *
 * Devuelve el cierre de la última rueda disponible y el de la anterior, que es
 * lo que necesita la variación del día. No hay book ni hora de trade: fuera de
 * rueda esos datos no existen, y no se inventan.
 */
export function fetchClosingQuotes(
  symbols: readonly string[],
  signal?: AbortSignal,
): Promise<Map<string, Quote>> {
  return memo(`cierres:${symbols.join(',')}`, TTL_CIERRE_MS, () =>
    traerCierres(symbols, signal),
  );
}

async function traerCierres(
  symbols: readonly string[],
  signal?: AbortSignal,
): Promise<Map<string, Quote>> {
  const quotes = new Map<string, Quote>();
  const LOTE = 4; // BYMA no documenta rate limit; no lo apuramos

  for (let i = 0; i < symbols.length; i += LOTE) {
    const lote = symbols.slice(i, i + LOTE);
    const series = await Promise.all(
      lote.map((s) => conReintento(() => fetchHistory(s, 20, signal), [] as Cierre[])),
    );

    lote.forEach((symbol, k) => {
      const barras = series[k];
      if (!barras.length) return;
      const ultima = barras[barras.length - 1];
      const previa = barras[barras.length - 2];

      quotes.set(symbol, {
        symbol,
        last: ultima.close || null,
        previousClose: previa?.close ?? null,
        open: null,
        high: null,
        low: null,
        vwap: null,
        bid: null,
        ask: null,
        bidSize: null,
        askSize: null,
        volumeNominal: ultima.volume,
        /*
         * La serie histórica sólo trae volumen nominal: no publica ni el monto
         * efectivo ni el VWAP. Se reconstruye con el precio de cierre.
         *
         * En el panel en vivo la identidad es exacta —nominal × VWAP / 100 da
         * el volumeAmount de BYMA al peso—, así que la única aproximación acá
         * es usar el cierre en lugar del VWAP de la rueda. Medido sobre S30O6:
         * VWAP 130,15 contra cierre 130,09, un 0,05% de diferencia. Es un
         * error mucho menor que el de mostrar el nominal, que para ese papel
         * quedaba 30% abajo.
         *
         * Esta rama sólo se usa de madrugada, cuando BYMA ya rotó el panel.
         * Durante la rueda y en las horas posteriores al cierre el monto sale
         * exacto del panel.
         */
        volumeAmount:
          ultima.volume !== null ? (ultima.volume * ultima.close) / 100 : null,
        orderCount: null,
        lastTradeTime: null,
        currency: 'ARS',
        settlement: 'T+1',
        maturityDate: null,
        priceDate: ultima.date,
        source: 'byma',
      });
    });
  }

  return quotes;
}
