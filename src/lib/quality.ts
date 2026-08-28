import type { Quote, QualityFlag, QualityLevel } from './types';

export interface QualityThresholds {
  /** Cantidad mínima de operaciones en el día. */
  minOrderCount: number;
}

export const DEFAULT_THRESHOLDS: QualityThresholds = {
  minOrderCount: 10,
};

const SEVERITY: Record<QualityLevel, number> = { ok: 0, warn: 1, bad: 2 };

export function worstLevel(flags: QualityFlag[]): QualityLevel {
  return flags.reduce<QualityLevel>(
    (acc, f) => (SEVERITY[f.level] > SEVERITY[acc] ? f.level : acc),
    'ok',
  );
}

/**
 * Reglas de calidad del dato.
 *
 * Ningún instrumento se descarta acá. Un papel con problemas se devuelve
 * igual, marcado. La decisión de ocultarlo o atenuarlo es del frontend; el
 * backend informa el problema. Una curva con un outlier sin explicar es peor
 * que no tener curva.
 *
 * Sólo se marca lo que hace dudar del dato en sí: que no haya operado, que
 * casi no haya operado, o que el instrumento no cierre contra la referencia.
 *
 * Deliberadamente NO son criterios de calidad, aunque el dato viaje igual en
 * la respuesta: el book (spread bid/ask y ausencia de puntas), el plazo al
 * vencimiento, y el origen de la TEM de emisión (`reference.temSource`).
 */
export function evaluateQuote(
  quote: Quote,
  thresholds: QualityThresholds = DEFAULT_THRESHOLDS,
): QualityFlag[] {
  const flags: QualityFlag[] = [];

  const traded = (quote.orderCount ?? 0) > 0 || (quote.volumeAmount ?? 0) > 0;

  if (!traded) {
    flags.push({
      code: 'NO_TRADES_TODAY',
      level: 'bad',
      message: 'No registró operaciones en la rueda; el precio es el cierre anterior.',
    });
  } else if (
    quote.orderCount !== null &&
    quote.orderCount < thresholds.minOrderCount
  ) {
    flags.push({
      code: 'THIN_VOLUME',
      level: 'warn',
      message: `Solo ${quote.orderCount} operación${quote.orderCount === 1 ? '' : 'es'} en la rueda.`,
    });
  }

  return flags;
}
