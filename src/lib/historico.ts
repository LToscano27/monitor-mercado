import type { InstrumentRow, UniverseResponse, VistaUniverso } from './types';

/**
 * Historia de las curvas: una foto por rueda y por universo, guardada al
 * cierre.
 *
 * Se guardan los rendimientos ya calculados, no los precios crudos: así la
 * foto de un día es exactamente lo que la pantalla mostró ese día, y si
 * mañana cambia una convención no reescribe el pasado sin que nadie se
 * entere.
 *
 * Viven como archivos estáticos en `public/historico/`, uno por día, y se
 * piden sólo cuando el lector elige una fecha: la carga normal de la página
 * no los toca.
 */

export const RUTA_HISTORICO = '/historico';

/** Lo que hace falta de cada instrumento para dibujarlo y ajustar la curva. */
export type FotoInstrumento = Pick<
  InstrumentRow,
  | 'ticker'
  | 'estructura'
  | 'maturityDate'
  | 'daysToMaturity'
  | 'businessDaysToMaturity'
  | 'durationDays'
  | 'lastPrice'
  | 'tem'
  | 'tea'
> & {
  /** Nivel de calidad del dato ese día: decide si entraba al ajuste. */
  calidad: InstrumentRow['quality']['level'];
};

export interface FotoCurva {
  universe: string;
  /** Rueda de cuyo cierre salen los precios. */
  tradeDate: string;
  settlementDate: string;
  ejeX: VistaUniverso['ejeX'];
  instrumentos: FotoInstrumento[];
}

/** Fechas disponibles por universo, de la más vieja a la más nueva. */
export type IndiceHistorico = Record<string, string[]>;

export function fotoDesde(u: UniverseResponse): FotoCurva {
  return {
    universe: u.universe,
    tradeDate: u.tradeDate,
    settlementDate: u.settlementDate,
    ejeX: u.vista.ejeX,
    instrumentos: u.instruments
      .filter((i) => i.tea !== null)
      .map((i) => ({
        ticker: i.ticker,
        estructura: i.estructura,
        maturityDate: i.maturityDate,
        daysToMaturity: i.daysToMaturity,
        businessDaysToMaturity: i.businessDaysToMaturity,
        durationDays: i.durationDays === null ? null : Math.round(i.durationDays * 10) / 10,
        lastPrice: i.lastPrice,
        tem: i.tem,
        tea: i.tea,
        calidad: i.quality.level,
      })),
  };
}

/** La última fecha disponible que no sea posterior a la pedida. */
export function fechaDisponible(fechas: readonly string[], pedida: string): string | null {
  let elegida: string | null = null;
  for (const f of fechas) if (f <= pedida) elegida = f;
  return elegida;
}
