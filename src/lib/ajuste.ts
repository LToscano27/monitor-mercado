/**
 * Ajuste de la curva de mercado.
 *
 * Los rendimientos vienen ya calculados y acá no se toca ninguno: esto es
 * sólo la curva que pasa entre ellos. Lo usan el gráfico, que la redibuja con
 * los puntos que el lector deje visibles, y el backend, que la necesita para
 * evaluar las dos curvas en fechas comunes.
 */

import type { InstrumentRow } from './types';


export interface AjusteLogaritmico {
  /** TEA = a + b · ln(días) */
  a: number;
  b: number;
  /** Bondad del ajuste. Dice cuánto confiar en la curva dibujada. */
  r2: number;
  /** Cantidad de puntos que entraron en la regresión. */
  n: number;
  /** Rango de días efectivamente ajustado. */
  desde: number;
  hasta: number;
  evaluar(dias: number): number;
}

export interface PuntoAjuste {
  dias: number;
  valor: number;
}

/**
 * Regresión por mínimos cuadrados de la forma `valor = a + b · ln(días)`.
 *
 * Es la forma estándar en research de renta fija: el rendimiento se mueve
 * mucho en el tramo corto y se aplana en el largo, que es justo lo que
 * describe un logaritmo. Un ajuste lineal en días sobreestimaría el tramo
 * largo y aplastaría el corto.
 *
 * Devuelve null con menos de tres puntos: con dos, la "curva" pasa exacto por
 * ambos y no informa nada que los puntos no digan ya.
 */
export function regresionLogaritmica(puntos: PuntoAjuste[]): AjusteLogaritmico | null {
  const validos = puntos.filter(
    (p) => p.dias > 0 && Number.isFinite(p.dias) && Number.isFinite(p.valor),
  );
  if (validos.length < 3) return null;

  const n = validos.length;
  const xs = validos.map((p) => Math.log(p.dias));
  const ys = validos.map((p) => p.valor);

  const mediaX = xs.reduce((s, v) => s + v, 0) / n;
  const mediaY = ys.reduce((s, v) => s + v, 0) / n;

  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i] - mediaX) * (ys[i] - mediaY);
    sxx += (xs[i] - mediaX) ** 2;
  }
  // Todos los instrumentos al mismo plazo: no hay pendiente que estimar.
  if (sxx === 0) return null;

  const b = sxy / sxx;
  const a = mediaY - b * mediaX;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i += 1) {
    ssRes += (ys[i] - (a + b * xs[i])) ** 2;
    ssTot += (ys[i] - mediaY) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  const dias = validos.map((p) => p.dias);

  return {
    a,
    b,
    r2,
    n,
    desde: Math.min(...dias),
    hasta: Math.max(...dias),
    evaluar: (d: number) => a + b * Math.log(d),
  };
}

/**
 * A un día hábil o menos del vencimiento, la tasa implícita deja de ser
 * información: el plazo es tan corto que un centavo de precio la mueve casi un
 * punto básico por cada día que falta. Esos papeles entran a la pantalla igual
 * —en la tabla, con su precio y su variación— pero salen de la curva por
 * defecto, para no torcer el ajuste con un punto que es ruido.
 *
 * Es un default, no una regla: la ficha del papel sigue ahí y con un clic
 * vuelve.
 */
export const HABILES_MINIMOS_EN_CURVA = 2;

/** Si un instrumento está en la curva cuando nadie decidió nada a mano. */
export function entraALaCurvaPorDefecto(
  i: Pick<InstrumentRow, 'businessDaysToMaturity'>,
): boolean {
  return i.businessDaysToMaturity >= HABILES_MINIMOS_EN_CURVA;
}

/**
 * Puntos del ajuste con la regla por defecto: cero cupón, sin marcas y lejos
 * del vencimiento.
 *
 * Sólo los cero cupón porque la curva mide la tasa pura a cada plazo. Un bono
 * que paga cupón promedia varios plazos y un dual trae una opción adentro: los
 * dos se muestran, pero no definen la curva.
 */
export function puntosDelAjuste(
  instrumentos: readonly InstrumentRow[],
  metrica: 'tem' | 'tea',
): PuntoAjuste[] {
  return instrumentos
    .filter(
      (i) =>
        i.estructura === 'cero-cupon' &&
        entraALaCurvaPorDefecto(i) &&
        i.quality.level === 'ok' &&
        i[metrica] !== null,
    )
    .map((i) => ({ dias: i.daysToMaturity, valor: i[metrica] as number }));
}
