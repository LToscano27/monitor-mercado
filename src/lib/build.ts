import {
  businessDaysBetween,
  CONVENTIONS_META,
  daysBetween,
  isWithinTradingHours,
  marketToday,
  parseIsoDate,
  settlementDate,
  toIsoDate,
} from './conventions';
import { evaluateQuote, worstLevel } from './quality';
import * as byma from './sources/byma';
import type {
  InstrumentRow,
  QualityFlag,
  Quote,
  UniverseResponse,
  ZeroCouponReference,
} from './types';
import type { UniverseDefinition } from './universes/types';

/**
 * Presupuesto total del request, por debajo del maxDuration de la función.
 *
 * El panel y la serie de cierres pueden encadenarse. Si cada uno usa su
 * timeout completo la suma se pasa y Vercel devuelve 504, que es la peor
 * respuesta posible: ni datos ni explicación. Con un presupuesto compartido,
 * el segundo intento usa lo que sobra y siempre queda tiempo para responder.
 */
const PRESUPUESTO_MS = 18_000;
/** BYMA sano responde en ~2s. Si tarda más, cortamos y vamos a los cierres. */
const PANEL_TIMEOUT_MS = 5_000;
/** La serie de cierre son ~11 pedidos en lotes; se le deja lo que quede. */
const CLOSING_TIMEOUT_MAX_MS = 12_000;
/** Debajo de esto no vale la pena arrancar un intento. */
const MINIMO_UTIL_MS = 1_500;

/** Offset fijo de la plaza local. Argentina no aplica horario de verano. */
const MARKET_UTC_OFFSET = '-03:00';

/** Patrón de ticker base del Tesoro, usado para detectar especies nuevas. */
const BASE_TICKER = /^[STM][A-Z0-9]{2,3}[0-9]$/;

interface QuoteFetchResult {
  quotes: Map<string, Quote>;
  session: UniverseResponse['session'];
  warnings: string[];
}

/** Reloj del presupuesto: cuánto queda antes de tener que responder. */
function crearPresupuesto(total = PRESUPUESTO_MS) {
  const vence = Date.now() + total;
  return {
    restante: () => vence - Date.now(),
    /** Corre `fn` con el menor entre su timeout y lo que quede de presupuesto. */
    correr<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
      const disponible = Math.min(ms, vence - Date.now());
      if (disponible < MINIMO_UTIL_MS) {
        return Promise.reject(new Error('sin tiempo en el presupuesto del request'));
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), disponible);
      return fn(controller.signal).finally(() => clearTimeout(timer));
    },
  };
}

/**
 * ¿El panel trae los datos de una rueda?
 *
 * Fuera de horario BYMA no deja de responder: en algún momento de la noche
 * rota a la sesión siguiente y devuelve el panel completo con todos los campos
 * en cero, cierre anterior incluido. Un panel ceroteado no es "el mercado no
 * operó", es "todavía no hay rueda".
 *
 * Mientras el panel tenga datos es la mejor fuente que existe, esté el mercado
 * abierto o cerrado: es la única que trae el volumen efectivo de la rueda.
 */
function panelTieneDatos(
  quotes: Map<string, Quote>,
  universe: UniverseDefinition,
): boolean {
  for (const symbol of universe.reference.keys()) {
    const q = quotes.get(symbol);
    if (q && (q.last !== null || q.previousClose !== null) && q.lastTradeTime) return true;
  }
  return false;
}

/**
 * BYMA es la única fuente, y eso es deliberado.
 *
 * El respaldo que había servía el último precio conocido sin decir de cuándo
 * era. Eso no es un dato de mercado: es un número con forma de dato.
 * Descontarlo contra una fecha de liquidación inflaba las tasas del tramo
 * corto y llegó a dar vuelta la curva entera.
 *
 * Quedan dos caminos, los dos con fecha conocida: el panel en vivo si hay
 * rueda, y la serie histórica si está cerrada. Si BYMA no responde, no hay
 * respuesta — un error explícito antes que una curva inventada.
 */
async function fetchQuotes(
  universe: UniverseDefinition,
  ahora: Date,
): Promise<QuoteFetchResult> {
  const warnings: string[] = [];
  const presupuesto = crearPresupuesto();

  let panel: Map<string, Quote> | null = null;
  try {
    panel = await presupuesto.correr(
      (signal) => byma.fetchQuotes(universe.bymaPanels, signal),
      PANEL_TIMEOUT_MS,
    );
  } catch (err) {
    warnings.push(`El panel de BYMA no respondió (${(err as Error).message}).`);
  }

  if (panel && panelTieneDatos(panel, universe)) {
    // El panel manda mientras tenga datos. Si el mercado ya cerró, esos datos
    // son los del cierre —precio, variación y volumen efectivo de toda la
    // rueda—, y sólo cambia cómo se los llama.
    return {
      quotes: panel,
      session: isWithinTradingHours(ahora) ? 'intradiaria' : 'cierre',
      warnings,
    };
  }

  // Mercado cerrado: los precios son los de cierre de la última rueda.
  let cierres = new Map<string, Quote>();
  try {
    cierres = await presupuesto.correr(
      (signal) => byma.fetchClosingQuotes([...universe.reference.keys()], signal),
      Math.min(CLOSING_TIMEOUT_MAX_MS, presupuesto.restante()),
    );
  } catch (err) {
    warnings.push(`La serie histórica de BYMA no respondió (${(err as Error).message}).`);
  }

  if (cierres.size === 0) {
    // El mensaje arrastra todo lo que falló, no sólo el último paso: sin eso
    // el error dice "no hubo cierres" y esconde que BYMA no contestó nunca.
    throw new Error(
      ['No se pudieron traer datos de BYMA.', ...warnings].join(' '),
    );
  }
  return { quotes: cierres, session: 'cierre', warnings };
}

export async function buildUniverse(
  universe: UniverseDefinition,
  now: Date = new Date(),
): Promise<UniverseResponse> {
  const { quotes, session, warnings } = await fetchQuotes(universe, now);

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

  /*
   * El universo vigente se arma en cada request, no se hereda del archivo.
   *
   * Las especies que ya vencieron salen solas: el lunes que S31G6 liquide, deja
   * de existir para la curva sin que nadie toque nada. Y las que aparecieron en
   * el panel y no están en la referencia se resuelven contra la ficha técnica
   * de BYMA y entran con todas las funciones, también solas.
   *
   * La referencia versionada queda como base y como lugar de los overrides
   * manuales, no como lista cerrada.
   */
  const vigentes = new Map<string, ZeroCouponReference>();
  for (const [symbol, ref] of universe.reference) {
    if (ref.maturityDate > tradeDateIso) vigentes.set(symbol, ref);
  }

  const desconocidos = [...quotes.entries()]
    .filter(
      ([symbol, quote]) =>
        BASE_TICKER.test(symbol) &&
        !vigentes.has(symbol) &&
        !universe.reference.has(symbol) &&
        !universe.knownNonMembers.has(symbol) &&
        quote.maturityDate !== null &&
        quote.maturityDate > tradeDateIso,
    )
    .map(([symbol]) => symbol);

  if (desconocidos.length > 0) {
    try {
      const { nuevas, sinResolver } = await universe.descubrir(desconocidos);
      for (const ref of nuevas) vigentes.set(ref.symbol, ref);
      if (nuevas.length > 0) {
        warnings.push(
          `Especies nuevas incorporadas automáticamente: ${nuevas.map((n) => n.symbol).join(', ')}.`,
        );
      }
      for (const { symbol, motivo } of sinResolver) {
        warnings.push(`No se pudo incorporar ${symbol}: ${motivo}.`);
      }
    } catch (err) {
      warnings.push(`No se pudieron resolver especies nuevas (${(err as Error).message}).`);
    }
  }

  const instruments: InstrumentRow[] = [];

  for (const [symbol, ref] of vigentes) {
    const maturity = parseIsoDate(ref.maturityDate);
    const quote = quotes.get(symbol);

    /*
     * El plazo sale de la rueda en la que el papel realmente cotiza, no de una
     * regla de fechas. Casi todos operan a 24hs; los que están por vencer
     * pierden esa rueda —liquidaría en el vencimiento o después— y quedan solo
     * en contado, que liquida el mismo día. Los días se cuentan desde la fecha
     * en que el comprador efectivamente paga.
     */
    const settlementBasis: InstrumentRow['settlementBasis'] = quote?.settlement ?? 'T+1';
    const liquidacion = settlementBasis === 'contado' ? tradeDate : settlement;
    const daysToMaturity = daysBetween(liquidacion, maturity);
    const businessDaysToMaturity = businessDaysBetween(liquidacion, maturity);

    if (!quote) {
      instruments.push(
        emptyRow(ref, daysToMaturity, businessDaysToMaturity, settlementBasis, {
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
        message: `Vence el ${ref.maturityDate}, anterior o igual a la liquidación ${toIsoDate(liquidacion)}.`,
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

    const valuation = universe.valuate(ref, quote, price, liquidacion);
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
      businessDaysToMaturity,
      settlementBasis,
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

  return {
    universe: universe.slug,
    label: universe.label,
    tradeDate: tradeDateIso,
    session,
    settlementDate: toIsoDate(settlement),
    fetchedAt: now.toISOString(),
    source: 'byma',
    conventions: CONVENTIONS_META,
    instruments,
    warnings,
  };
}

function emptyRow(
  ref: ZeroCouponReference,
  daysToMaturity: number,
  businessDaysToMaturity: number,
  settlementBasis: InstrumentRow['settlementBasis'],
  flag: QualityFlag,
): InstrumentRow {
  return {
    ticker: ref.symbol,
    name: ref.name,
    maturityDate: ref.maturityDate,
    daysToMaturity,
    businessDaysToMaturity,
    settlementBasis,
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
