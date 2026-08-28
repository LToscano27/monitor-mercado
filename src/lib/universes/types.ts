import type { BymaPanel } from '../sources/byma';
import type { QualityThresholds } from '../quality';
import type { Quote, ZeroCouponReference } from '../types';

/**
 * Un universo es un conjunto de instrumentos con un mismo motor de
 * valuación. Hoy sólo existe tasa fija; CER y dólar linked se agregan
 * registrando otra definición acá, sin tocar el endpoint ni el frontend.
 *
 * El motor de valuación es parte de la definición porque es lo que cambia
 * entre curvas: un CER necesita el coeficiente del día, un dólar linked
 * necesita el tipo de cambio de referencia.
 */
export interface UniverseValuation {
  finalPayment: number;
  daysToMaturity: number;
  tem: number;
  tea: number;
}

export interface UniverseDefinition {
  slug: string;
  label: string;
  description: string;
  bymaPanels: readonly BymaPanel[];
  thresholds: QualityThresholds;
  /** Referencia estática por ticker, generada por scripts/refresh-reference.ts. */
  reference: ReadonlyMap<string, ZeroCouponReference>;
  /** Tickers evaluados y descartados, con el motivo. Alimenta los warnings. */
  knownNonMembers: ReadonlyMap<string, string>;
  /** Tickers candidatos que la referencia no pudo resolver. */
  unresolved: readonly string[];
  /**
   * Incorpora especies que aparecieron en el panel y no están en la
   * referencia versionada.
   *
   * El Tesoro emite seguido, y una LECAP nueva tiene que entrar sola: esperar
   * a que alguien corra un script deja la curva incompleta justo cuando hay
   * novedades. Recibe los símbolos desconocidos y devuelve los que pertenecen
   * al universo, ya resueltos.
   */
  descubrir(
    simbolos: readonly string[],
    signal?: AbortSignal,
  ): Promise<{
    nuevas: ZeroCouponReference[];
    /** Los que no se pudieron resolver, cada uno con su motivo. */
    sinResolver: { symbol: string; motivo: string }[];
  }>;
  valuate(
    ref: ZeroCouponReference,
    quote: Quote,
    price: number | null,
    settlement: Date,
  ): UniverseValuation | null;
}
