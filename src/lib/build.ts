import {
  CONVENTIONS_META,
  daysBetween,
  marketToday,
  parseIsoDate,
  settlementDate,
  toIsoDate,
} from './conventions';
import { evaluateQuote, worstLevel } from './quality';
import * as byma from './sources/byma';
import * as data912 from './sources/data912';
import type {
  InstrumentRow,
  QualityFlag,
  Quote,
  SourceId,
  UniverseResponse,
  ZeroCouponReference,
} from './types';
import type { UniverseDefinition } from './universes/types';

const FETCH_TIMEOUT_MS = 12_000;
/** La serie de cierre son ~11 pedidos en lotes; necesita más aire. */
const CLOSING_TIMEOUT_MS = 25_000;

/** Offset fijo de la plaza local. Argentina no aplica horario de verano. */
const MARKET_UTC_OFFSET = '-03:00';

/** Patrón de ticker base del Tesoro, usado para detectar especies nuevas. */
const BASE_TICKER = /^[STM][A-Z0-9]{2,3}[0-9]$/;

interface QuoteFetchResult {
  quotes: Map<string, Quote>;
  source: SourceId;
  fallbackUsed: boolean;
  session: UniverseResponse['session'];
  warnings: string[];
}

function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms = FETCH_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fn(controller.signal).finally(() => clearTimeout(timer));
}

/**
 * ¿El panel tiene una rueda en curso?
 *
 * Hacen falta dos cosas, y las dos importan:
 *
 *  1. Precios. Fuera de horario BYMA no deja de responder: devuelve el panel
 *     completo con todos los campos en cero, cierre anterior incluido. Un
 *     panel ceroteado no es "el mercado no operó", es "no hay rueda abierta".
 *
 *  2. Hora de algún trade. data912 sigue sirviendo el último precio conocido
 *     mucho después del cierre, sin decir de cuándo es. Sin hora de trade no
 *     hay evidencia de rueda abierta, y llamar "en curso" a un precio de ayer
 *     es peor que no mostrarlo: el lector cree que está viendo el mercado.
 */
function panelTieneRueda(
  quotes: Map<string, Quote>,
  universe: UniverseDefinition,
): boolean {
  let hayPrecio = false;
  let hayHora = false;
  for (const symbol of universe.reference.keys()) {
    const q = quotes.get(symbol);
    if (!q) continue;
    if (q.last !== null || q.previousClose !== null) hayPrecio = true;
    if (q.lastTradeTime) hayHora = true;
  }
  return hayPrecio && hayHora;
}

/**
 * BYMA es la fuente principal: es la única que trae vencimiento, cierre
 * anterior y hora del último trade. data912 queda como respaldo — está
 * verificado que es un espejo de BYMA, así que los números no cambian, pero
 * pierde la hora del trade.
 *
 * Con el mercado cerrado ninguno de los dos paneles sirve, y ahí se va a la
 * serie histórica de BYMA a buscar el cierre real de la última rueda.
 */
async function fetchQuotesWithFallback(
  universe: UniverseDefinition,
): Promise<QuoteFetchResult> {
  const warnings: string[] = [];
  let quotes: Map<string, Quote> | null = null;
  let source: SourceId = 'byma';
  let fallbackUsed = false;

  try {
    quotes = await withTimeout((signal) => byma.fetchQuotes(universe.bymaPanels, signal));
  } catch (err) {
    warnings.push(
      `BYMA no respondió (${(err as Error).message}); se usó data912 como respaldo.`,
    );
    try {
      quotes = await withTimeout((signal) =>
        data912.fetchQuotes(universe.data912Feeds, signal),
      );
      source = 'data912';
      fallbackUsed = true;
    } catch (err2) {
      warnings.push(`data912 tampoco respondió (${(err2 as Error).message}).`);
    }
  }

  if (quotes && panelTieneRueda(quotes, universe)) {
    return { quotes, source, fallbackUsed, session: 'intradiaria', warnings };
  }

  // Mercado cerrado: los precios son los de cierre de la última rueda.
  try {
    const cierres = await withTimeout(
      (signal) => byma.fetchClosingQuotes([...universe.reference.keys()], signal),
      CLOSING_TIMEOUT_MS,
    );
    if (cierres.size > 0) {
      return { quotes: cierres, source: 'byma', fallbackUsed: false, session: 'cierre', warnings };
    }
    warnings.push('La serie histórica de BYMA no devolvió cierres.');
  } catch (err) {
    warnings.push(`No se pudieron traer los cierres de BYMA (${(err as Error).message}).`);
  }

  // Último recurso: lo que haya quedado en el panel, avisando que no sabemos
  // a qué momento corresponde.
  if (quotes) {
    warnings.push(
      'Los precios salen del panel en vivo pero no hay hora de trade: puede que no correspondan a la rueda en curso.',
    );
    return { quotes, source, fallbackUsed, session: 'intradiaria', warnings };
  }
  throw new Error('Ninguna fuente devolvió datos.');
}

export async function buildUniverse(
  universe: UniverseDefinition,
  now: Date = new Date(),
): Promise<UniverseResponse> {
  const { quotes, source, fallbackUsed, session, warnings } =
    await fetchQuotesWithFallback(universe);

  // Con el mercado cerrado la rueda de referencia no es hoy: es la última
  // rueda con datos. La liquidación T+1 y el conteo de días cuelgan de ahí,
  // así que tienen que salir de la misma fecha que el precio.
  const fechasCierre = [...quotes.values()]
    .map((q) => q.priceDate)
    .filter((d): d is string => Boolean(d))
    .sort();
  const tradeDateIso =
    session === 'cierre' && fechasCierre.length
      ? fechasCierre[fechasCierre.length - 1]
      : toIsoDate(marketToday(now));
  const tradeDate = parseIsoDate(tradeDateIso);
  const settlement = settlementDate(tradeDate);

  const instruments: InstrumentRow[] = [];

  for (const [symbol, ref] of universe.reference) {
    const maturity = parseIsoDate(ref.maturityDate);
    const daysToMaturity = daysBetween(settlement, maturity);
    const quote = quotes.get(symbol);

    if (!quote) {
      instruments.push(
        emptyRow(ref, daysToMaturity, {
          code: 'STALE_PRICE',
          level: 'bad',
          message:
            'El instrumento está en la referencia pero la fuente no lo devolvió en esta rueda.',
        }),
      );
      continue;
    }

    const flags: QualityFlag[] = evaluateQuote(quote, universe.thresholds);

    // Si no operó, el mejor precio disponible es el cierre anterior. Se usa,
    // pero el papel ya quedó marcado con NO_TRADES_TODAY.
    const traded =
      (quote.orderCount ?? 0) > 0 ||
      (quote.volumeAmount ?? 0) > 0 ||
      (quote.volumeNominal ?? 0) > 0;
    const price =
      session === 'cierre' ? quote.last : traded ? quote.last : (quote.previousClose ?? quote.last);
    const priceBasis: InstrumentRow['priceBasis'] =
      price === null ? null : session === 'cierre' ? 'close' : traded ? 'trade' : 'previous-close';

    if (daysToMaturity <= 0) {
      flags.push({
        code: 'MATURED',
        level: 'bad',
        message: `Vence el ${ref.maturityDate}, anterior o igual a la liquidación ${toIsoDate(settlement)}.`,
      });
    }

    // La fuente informa su propio vencimiento; si difiere de la referencia,
    // uno de los dos está mal y el rendimiento no es confiable.
    if (quote.maturityDate && quote.maturityDate !== ref.maturityDate) {
      flags.push({
        code: 'MATURITY_MISMATCH',
        level: 'bad',
        message: `La fuente informa vencimiento ${quote.maturityDate} y la referencia ${ref.maturityDate}.`,
      });
    }

    const valuation = universe.valuate(ref, quote, price, settlement);
    if (price !== null && valuation === null) {
      flags.push({
        code: 'MISSING_REFERENCE',
        level: 'bad',
        message: 'No se pudo calcular el rendimiento con los datos disponibles.',
      });
    }

    const previousClose = quote.previousClose;
    const priceChange =
      price !== null && previousClose !== null ? price - previousClose : null;

    instruments.push({
      ticker: symbol,
      name: ref.name,
      maturityDate: ref.maturityDate,
      daysToMaturity,
      lastPrice: price,
      priceBasis,
      priceDate: quote.priceDate ?? tradeDateIso,
      priceChange,
      priceChangePct:
        priceChange !== null && previousClose
          ? (priceChange / previousClose) * 100
          : null,
      tem: valuation?.tem ?? null,
      tea: valuation?.tea ?? null,
      finalPayment: valuation?.finalPayment ?? null,
      bid: quote.bid,
      ask: quote.ask,
      volumeAmount: quote.volumeAmount,
      volumeNominal: quote.volumeNominal,
      orderCount: quote.orderCount,
      lastTradeTime: quote.lastTradeTime,
      dataTimestamp: quote.lastTradeTime
        ? `${tradeDateIso}T${quote.lastTradeTime}${MARKET_UTC_OFFSET}`
        : null,
      quality: { level: worstLevel(flags), flags },
      reference: {
        issueDate: ref.issueDate,
        issueTem: ref.issueTem,
        temSource: ref.temSource,
        isin: ref.isin,
      },
    });
  }

  instruments.sort((a, b) => a.daysToMaturity - b.daysToMaturity);

  // Un ticker que cotiza, tiene forma de especie del universo y no está
  // clasificado es una emisión nueva. No lo inventamos ni lo escondemos:
  // se avisa para correr refresh:reference.
  const unclassified = [...quotes.keys()].filter(
    (s) =>
      BASE_TICKER.test(s) &&
      !universe.reference.has(s) &&
      !universe.knownNonMembers.has(s) &&
      !universe.unresolved.includes(s),
  );
  if (unclassified.length > 0) {
    warnings.push(
      `Tickers sin clasificar en la referencia: ${unclassified.join(', ')}. Correr "npm run refresh:reference".`,
    );
  }
  if (universe.unresolved.length > 0) {
    warnings.push(
      `Tickers candidatos que la referencia no pudo resolver: ${universe.unresolved.join(', ')}.`,
    );
  }

  return {
    universe: universe.slug,
    label: universe.label,
    tradeDate: tradeDateIso,
    session,
    settlementDate: toIsoDate(settlement),
    fetchedAt: now.toISOString(),
    source,
    sourceFallbackUsed: fallbackUsed,
    conventions: CONVENTIONS_META,
    instruments,
    warnings,
  };
}

function emptyRow(
  ref: ZeroCouponReference,
  daysToMaturity: number,
  flag: QualityFlag,
): InstrumentRow {
  return {
    ticker: ref.symbol,
    name: ref.name,
    maturityDate: ref.maturityDate,
    daysToMaturity,
    lastPrice: null,
    priceBasis: null,
    priceDate: null,
    priceChange: null,
    priceChangePct: null,
    tem: null,
    tea: null,
    finalPayment: null,
    bid: null,
    ask: null,
    volumeAmount: null,
    volumeNominal: null,
    orderCount: null,
    lastTradeTime: null,
    dataTimestamp: null,
    quality: { level: flag.level, flags: [flag] },
    reference: {
      issueDate: ref.issueDate,
      issueTem: ref.issueTem,
      temSource: ref.temSource,
      isin: ref.isin,
    },
  };
}
