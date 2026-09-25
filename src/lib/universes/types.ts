import type { ConventionsMeta } from '../conventions';
import type { BymaPanel } from '../sources/byma';
import type { QualityThresholds } from '../quality';
import type { CerDetalle, InstrumentReference, Quote } from '../types';

/**
 * Un universo es un conjunto de instrumentos con un mismo motor de
 * valuación. CER y dólar linked se agregan registrando otra definición,
 * sin tocar el endpoint.
 *
 * El motor de valuación es parte de la definición porque es lo que cambia
 * entre curvas: un CER necesita el coeficiente del día, un dólar linked
 * necesita el tipo de cambio de referencia.
 */
export interface UniverseValuation {
  /** Null cuando el pago al vencimiento todavía no se conoce (CER). */
  finalPayment: number | null;
  daysToMaturity: number;
  tem: number;
  tea: number;
  cer?: CerDetalle;
}

/**
 * @typeParam R referencia estática de cada instrumento.
 * @typeParam C datos de mercado que la valuación necesita además del precio,
 *   traídos una vez por request (el CER, por ejemplo). `void` si no hace falta.
 */
export interface UniverseDefinition<R extends InstrumentReference = InstrumentReference, C = void> {
  slug: string;
  label: string;
  description: string;
  bymaPanels: readonly BymaPanel[];
  /**
   * Forma del ticker base de las especies del universo. Decide qué tickers
   * desconocidos del panel vale la pena mirar para ver si son nuevos.
   */
  candidateSymbol: RegExp;
  thresholds: QualityThresholds;
  conventions: ConventionsMeta;
  /** Referencia estática por ticker, generada por scripts/refresh-reference.ts. */
  reference: ReadonlyMap<string, R>;
  /** Tickers evaluados y descartados, con el motivo. Alimenta los warnings. */
  knownNonMembers: ReadonlyMap<string, string>;
  /** Tickers candidatos que la referencia no pudo resolver. */
  unresolved: readonly string[];
  /**
   * Incorpora especies que aparecieron en el panel y no están en la
   * referencia versionada.
   *
   * El Tesoro emite seguido, y una letra nueva tiene que entrar sola: esperar
   * a que alguien corra un script deja la curva incompleta justo cuando hay
   * novedades. Recibe los símbolos desconocidos y devuelve los que pertenecen
   * al universo, ya resueltos.
   */
  descubrir(
    simbolos: readonly string[],
    signal?: AbortSignal,
  ): Promise<{
    nuevas: R[];
    /** Los que no se pudieron resolver, cada uno con su motivo. */
    sinResolver: { symbol: string; motivo: string }[];
  }>;
  /**
   * Trae lo que la valuación necesita además del precio, una sola vez por
   * request. Si falla, los instrumentos salen sin rendimiento y marcados, y
   * el motivo va a los warnings: nunca se valúa con un dato inventado.
   */
  prepararValuacion?(
    vigentes: readonly R[],
    liquidacion: Date,
    signal?: AbortSignal,
  ): Promise<C>;
  valuate(
    ref: R,
    quote: Quote,
    price: number | null,
    settlement: Date,
    contexto: C | undefined,
  ): UniverseValuation | null;
}

/**
 * Un universo cualquiera del registro. Cada uno tiene su propia referencia y
 * su propio contexto de valuación; quien los recorre a todos no necesita
 * saber cuáles.
 */
export type AnyUniverse = UniverseDefinition<any, any>;
