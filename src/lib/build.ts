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

const FETCH_TIMEOUT_MS = 8_000;

/** Offset fijo de la plaza local. Argentina no aplica horario de verano. */
const MARKET_UTC_OFFSET = '-03:00';

/** Patrón de ticker base del Tesoro, usado para detectar especies nuevas. */
const BASE_TICKER = /^[STM][A-Z0-9]{2,3}[0-9]$/;

interface QuoteFetchResult {
  quotes: Map<string, Quote>;
  source: SourceId;
  fallbackUsed: boolean;
  warnings: string[];
}

function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fn(controller.signal).finally(() => clearTimeout(timer));
}

/**
 * BYMA es la fuente principal: es la única que trae vencimiento, cierre
 * anterior y hora del último trade. data912 queda como respaldo — está
 * verificado que es un espejo de BYMA, así que los números no cambian, pero
 * pierde la hora del trade.
 */
async function fetchQuotesWithFallback(
  universe: UniverseDefinition,
): Promise<QuoteFetchResult> {
  const warnings: string[] = [];
  try {
    const quotes = await withTimeout((signal) =>
      byma.fetchQuotes(universe.bymaPanels, signal),
    );
    return { quotes, source: 'byma', fallbackUsed: false, warnings };
  } catch (err) {
    warnings.push(
      `BYMA no respondió (${(err as Error).message}); se usó data912 como respaldo. La hora del último trade no está disponible en esa fuente.`,
    );
  }
  const quotes = await withTimeout((signal) =>
    data912.fetchQuotes(universe.data912Feeds, signal),
  );
  return { quotes, source: 'data912', fallbackUsed: true, warnings };
}

export async function buildUniverse(
  universe: UniverseDefinition,
  now: Date = new Date(),
): Promise<UniverseResponse> {
  const { quotes, source, fallbackUsed, warnings } =
    await fetchQuotesWithFallback(universe);

  const tradeDate = marketToday(now);
  const settlement = settlementDate(tradeDate);
  const tradeDateIso = toIsoDate(tradeDate);

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
    const traded = (quote.orderCount ?? 0) > 0 || (quote.volumeAmount ?? 0) > 0;
    const price = traded ? quote.last : (quote.previousClose ?? quote.last);
    const priceBasis: InstrumentRow['priceBasis'] =
      price === null ? null : traded ? 'trade' : 'previous-close';

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
    priceChange: null,
    priceChangePct: null,
    tem: null,
    tea: null,
    finalPayment: null,
    bid: null,
    ask: null,
    volumeAmount: null,
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
