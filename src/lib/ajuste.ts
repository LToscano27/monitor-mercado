/**
 * Ajuste de la curva de mercado.
 *
 * Esto es geometría del gráfico, no valuación: los rendimientos vienen ya
 * calculados del backend y acá no se toca ninguno. El ajuste vive en el
 * cliente porque depende de qué puntos están visibles, y eso lo decide el
 * lector con el control de "ocultar datos marcados".
 */

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
