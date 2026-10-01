/**
 * Ajuste de la curva de mercado.
 *
 * Los rendimientos vienen ya calculados y acá no se toca ninguno: esto es
 * sólo la curva que pasa entre ellos. Lo usan el gráfico, que la redibuja con
 * los puntos que el lector deje visibles, y el backend, que la necesita para
 * evaluar las dos curvas en fechas comunes.
 */

import type { InstrumentRow } from './types';


interface AjusteBase {
  /** Bondad del ajuste. Dice cuánto confiar en la curva dibujada. */
  r2: number;
  /** Cantidad de puntos que entraron en la regresión. */
  n: number;
  /** Rango de días efectivamente ajustado. */
  desde: number;
  hasta: number;
  evaluar(dias: number): number;
}

export interface AjusteLogaritmico extends AjusteBase {
  modelo: 'logaritmico';
  /** TEA = a + b · ln(días) */
  a: number;
  b: number;
}

export interface AjusteNelsonSiegel extends AjusteBase {
  modelo: 'nelson-siegel';
  /** Nivel: la tasa a la que tiende la curva en el plazo largo. */
  beta0: number;
  /** Pendiente: cuánto se aparta el tramo corto del nivel. */
  beta1: number;
  /** Curvatura: la joroba (o el valle) del tramo medio. */
  beta2: number;
  /** Escala de plazos, en días. La joroba cae cerca de 1,79 · τ. */
  tau: number;
}

export type AjusteCurva = AjusteNelsonSiegel | AjusteLogaritmico;
export type ModeloCurva = AjusteCurva['modelo'];

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
    modelo: 'logaritmico',
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
 * Con menos puntos que esto no se ajusta Nelson-Siegel: son cuatro
 * parámetros (tres betas y τ) y con cinco puntos la curva pasa casi exacta
 * por todos, que es copiar el ruido de cada precio y no ajustar nada.
 */
export const MINIMO_PUNTOS_NS = 6;

/** x en el que la carga de curvatura de Nelson-Siegel hace su máximo. */
const X_JOROBA = 1.7933;

/** Valores de τ que se prueban, repartidos en escala geométrica. */
const GRILLA_TAU = 40;

/**
 * Cuánto puede salirse la curva del rango de los puntos, como fracción de
 * ese rango, antes de descartarla. Una curva que entre dos papeles se va
 * más allá de eso no describe el mercado: está sobreajustando.
 */
const MARGEN_FUERA_DE_RANGO = 0.5;

/** Las dos cargas de Nelson-Siegel a un plazo, con x = días / τ. */
function cargasNs(dias: number, tau: number): [number, number] {
  const x = dias / tau;
  const e = Math.exp(-x);
  const pendiente = (1 - e) / x;
  return [pendiente, pendiente - e];
}

/**
 * Ajuste de Nelson-Siegel en su forma estándar:
 *
 *   TEA(T) = β0 + β1 · (1 − e^(−T/τ)) / (T/τ)
 *               + β2 · [(1 − e^(−T/τ)) / (T/τ) − e^(−T/τ)]
 *
 * Es la forma que usa el BCRA para la inflación implícita (Nota Técnica
 * N°8/2024). Acá no se publica: está para compararla contra el ajuste
 * logarítmico (`npm run validate:modelos`), que es el que se usa.
 *
 * Con τ fijo el modelo es lineal en las betas, así que no hace falta un
 * optimizador: se recorre una grilla de τ, para cada uno se sacan las betas
 * por mínimos cuadrados y queda el de menor error.
 *
 * τ se acota para que la joroba (≈ 1,79 · τ) caiga dentro del rango de plazos
 * con papeles. Fuera de ahí las dos cargas se vuelven casi iguales en todos
 * los puntos, las betas se disparan una contra la otra y la curva hace
 * cualquier cosa entre papel y papel.
 *
 * Devuelve null si hay menos de MINIMO_PUNTOS_NS puntos o si la curva se
 * sale del rango de los datos.
 */
export function nelsonSiegel(puntos: PuntoAjuste[]): AjusteNelsonSiegel | null {
  const validos = puntos.filter(
    (p) => p.dias > 0 && Number.isFinite(p.dias) && Number.isFinite(p.valor),
  );
  const n = validos.length;
  if (n < MINIMO_PUNTOS_NS) return null;

  const dias = validos.map((p) => p.dias);
  const ys = validos.map((p) => p.valor);
  const desde = Math.min(...dias);
  const hasta = Math.max(...dias);
  if (desde === hasta) return null;

  const mediaY = ys.reduce((s, v) => s + v, 0) / n;
  const ssTot = ys.reduce((s, v) => s + (v - mediaY) ** 2, 0);

  const tauMin = desde / X_JOROBA;
  const tauMax = hasta / X_JOROBA;
  let mejor: { tau: number; betas: [number, number, number]; ssRes: number } | null = null;
  for (let k = 0; k < GRILLA_TAU; k += 1) {
    const tau = tauMin * (tauMax / tauMin) ** (k / (GRILLA_TAU - 1));
    const filas = dias.map((d): [number, number, number] => [1, ...cargasNs(d, tau)]);
    const betas = minimosCuadrados3(filas, ys);
    if (!betas) continue;
    const ssRes = filas.reduce(
      (s, f, i) => s + (ys[i] - (betas[0] + betas[1] * f[1] + betas[2] * f[2])) ** 2,
      0,
    );
    if (!mejor || ssRes < mejor.ssRes) mejor = { tau, betas, ssRes };
  }
  if (!mejor) return null;

  const { tau, betas, ssRes } = mejor;
  const evaluar = (d: number) => {
    const [l1, l2] = cargasNs(d, tau);
    return betas[0] + betas[1] * l1 + betas[2] * l2;
  };

  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const margen = (maxY - minY) * MARGEN_FUERA_DE_RANGO;
  const MUESTRAS = 100;
  for (let k = 0; k <= MUESTRAS; k += 1) {
    const v = evaluar(desde + ((hasta - desde) * k) / MUESTRAS);
    if (!Number.isFinite(v) || v < minY - margen || v > maxY + margen) return null;
  }

  return {
    modelo: 'nelson-siegel',
    beta0: betas[0],
    beta1: betas[1],
    beta2: betas[2],
    tau,
    r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot,
    n,
    desde,
    hasta,
    evaluar,
  };
}

/** Mínimos cuadrados con tres regresores, por las ecuaciones normales. */
function minimosCuadrados3(
  filas: [number, number, number][],
  ys: number[],
): [number, number, number] | null {
  const a = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  filas.forEach((f, i) => {
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0; c < 3; c += 1) a[r][c] += f[r] * f[c];
      a[r][3] += f[r] * ys[i];
    }
  });
  // Eliminación de Gauss con pivoteo parcial.
  for (let col = 0; col < 3; col += 1) {
    let pivote = col;
    for (let r = col + 1; r < 3; r += 1) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivote][col])) pivote = r;
    }
    if (Math.abs(a[pivote][col]) < 1e-12) return null;
    [a[col], a[pivote]] = [a[pivote], a[col]];
    for (let r = 0; r < 3; r += 1) {
      if (r === col) continue;
      const factor = a[r][col] / a[col][col];
      for (let c = col; c < 4; c += 1) a[r][c] -= factor * a[col][c];
    }
  }
  return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
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
