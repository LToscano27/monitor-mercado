import { puntosDelAjuste, regresionLogaritmica, type AjusteLogaritmico } from './ajuste';
import { buildUniverse } from './build';
import {
  addDays,
  CER_LAG_BUSINESS_DAYS,
  DAY_COUNT_BASIS,
  DAYS_PER_MONTH,
  daysBetween,
  parseIsoDate,
  restarDiasHabiles,
  toIsoDate,
  type IsoDate,
} from './conventions';
import { fetchCer } from './sources/bcra';
import { fetchIpcMensual } from './sources/indec';
import type { CerPunto, UniverseResponse } from './types';
import { tasaCer } from './universes/tasa-cer';
import { tasaFija } from './universes/tasa-fija';

/**
 * Inflación breakeven: la que iguala, a cada plazo, lo que paga una tasa fija
 * con lo que paga un CER.
 *
 * Método: encadenado sobre curvas ajustadas. No se compara bono contra bono
 * —los vencimientos no coinciden y el encadenado amplifica el ruido de cada
 * precio—, sino las dos curvas ajustadas (TEA = a + b·ln días, sólo cero
 * cupón) evaluadas en las mismas fechas.
 *
 * ── El rezago, que es lo que decide qué mes mide cada tramo ──
 *
 * Un CER que vence el día t paga el CER de t − 10 hábiles, y quien lo compra
 * hoy recibe el ajuste desde el CER de liquidación − 10 hábiles (L). Así, la
 * comparación entre las dos curvas a la fecha t mide la inflación esperada
 * entre L y t − 10 hábiles:
 *
 *   (1 + TEA_nominal)^(d/365) / (1 + TEA_real)^(d/365) = CER(t − 10 háb) / CER(L)
 *
 * Y el CER, por metodología del BCRA, reparte el IPC de cada mes entre el día
 * 16 del mes siguiente y el 15 del subsiguiente: el CER del 16/10 al 15/11
 * acumula exactamente el IPC de septiembre.
 *
 * Entonces las fechas de evaluación no se eligen por calendario: se eligen
 * para que el CER hasta el que llega cada tramo sea justo un día 15. El tramo
 * entre dos fechas consecutivas mide un mes INDEC completo, sin pisarse con
 * el de al lado.
 *
 * ── A qué plazo de la curva corresponde cada CER ──
 *
 * Entre el vencimiento t y el CER que cobra, t − 10 hábiles, hay entre 14 y
 * 18 días corridos según caigan fines de semana y feriados. Si las curvas se
 * leyeran al plazo de t, esos días de más se cargarían como inflación del mes
 * en que caen y armarían un serrucho de ±0,1 punto entre meses: un artefacto
 * del calendario, no del mercado.
 *
 * Por eso el plazo al que se leen las curvas es el largo de la ventana del
 * CER, de L al día 15: d = días(L, 15). Es lo mismo que suponer el rezago
 * de hoy (liquidación − L) constante hacia adelante. La fecha de evaluación
 * que se informa es la liquidación más ese plazo; cae entre fin de mes y el
 * primero del siguiente, y el 15 puede ser feriado sin que importe: las
 * curvas son continuas.
 *
 * ── Ventanas de distinto largo ──
 *
 * La ventana del CER de un mes tiene el largo del mes siguiente: la de enero
 * va del 16/02 al 15/03, 28 días. Una curva suave reparte la inflación
 * esperada por día y no distingue un mes de otro, así que lo que acumula
 * una ventana corta sale más bajo sin que el mercado espere nada distinto:
 * enero quedaba 0,15 puntos abajo de sus vecinos por culpa de febrero, y
 * llevarlo a los días de enero sólo corría el bache a febrero.
 *
 * La inflación mensual se informa entonces como tasa de 30 días, la misma
 * convención de la TEM en todo el proyecto. Lo que acumula la ventana tal
 * cual viaja aparte: es lo que, encadenado, da el breakeven acumulado.
 *
 * ── Lo que ya se sabe no es breakeven ──
 *
 * El BCRA publica el CER hasta el 15 del mes siguiente al último IPC. Ese
 * tramo, desde L hasta el último CER publicado, es inflación conocida y va
 * aparte, con el dato del INDEC. El primer forward de mercado se mide contra
 * ese CER real, no contra la curva: la curva en ese plazo no agrega
 * información y sólo sumaría su error de ajuste.
 */

export interface AjusteResumen {
  a: number;
  b: number;
  r2: number;
  n: number;
  /** Rango de días cubierto por los instrumentos del ajuste. */
  desde: number;
  hasta: number;
}

export interface MesConocido {
  /** Mes INDEC, 'YYYY-MM'. */
  mes: string;
  /** Variación mensual publicada por el INDEC, sin redondear. */
  ipcIndec: number | null;
  /**
   * Lo que acumuló el CER en la ventana de ese mes, desde L si empezó antes.
   * Es el IPC redondeado a un decimal, que es lo que usa el BCRA.
   */
  cer: number;
  /** Si la ventana del mes empezó antes de L y sólo cuenta en parte. */
  parcial: boolean;
}

export type MarcaForward = 'negativo' | 'alto';

export interface MesBreakeven {
  mes: string;
  /** Ventana del CER que acumula este mes: del día siguiente a `desde` a `hasta`. */
  ventana: { desde: IsoDate; hasta: IsoDate };
  /** Liquidación más `dias`: donde se leen las curvas. */
  fechaEvaluacion: IsoDate;
  /** Plazo al que se leen las curvas: el largo de la ventana del CER desde L. */
  dias: number;
  /** TEA de la curva ajustada de tasa fija a ese plazo. */
  nominal: number;
  /** TEA real de la curva ajustada CER a ese plazo. */
  real: number;
  /** Inflación acumulada desde L hasta el fin de la ventana. */
  beAcumulado: number;
  /** Inflación implícita del mes INDEC, como tasa de 30 días. */
  inflacionMensual: number;
  /** Lo que acumula la ventana tal cual. Encadenada, da `beAcumulado`. */
  inflacionVentana: number;
  /**
   * Un forward negativo o de más del doble del último IPC no es una
   * expectativa: es un problema en el ajuste de alguna curva. Se marca y no
   * se suaviza.
   */
  marcas: MarcaForward[];
}

export interface BreakevenResponse {
  metodo: 'encadenado sobre curvas ajustadas';
  tradeDate: IsoDate;
  session: UniverseResponse['session'];
  settlementDate: IsoDate;
  fetchedAt: string;
  /** Hora del último trade más reciente entre los papeles de las dos curvas. */
  dataTimestamp: string | null;
  curvas: { nominal: AjusteResumen; real: AjusteResumen };
  cer: {
    /** L: CER de liquidación − 10 hábiles, punto de partida de todo. */
    liquidacion: CerPunto;
    ultimoPublicado: CerPunto;
  };
  conocida: {
    /** Inflación acumulada de L al último CER publicado. */
    acumulada: number;
    meses: MesConocido[];
    /**
     * Qué dice la curva en ese mismo tramo. No se usa para nada: sirve para
     * ver cuánto se aparta el ajuste en el tramo corto.
     */
    segunLaCurva: number | null;
  };
  meses: MesBreakeven[];
  warnings: string[];
}

/** Umbral de "anómalamente alto": el doble del último IPC publicado. */
const FACTOR_ALTO = 2;

export async function buildBreakeven(now: Date = new Date()): Promise<BreakevenResponse> {
  // Las dos a la vez: los paneles de BYMA se piden una sola vez y las dos
  // curvas salen de la misma foto.
  const [fija, cer] = await Promise.all([buildUniverse(tasaFija, now), buildUniverse(tasaCer, now)]);
  if (fija.tradeDate !== cer.tradeDate || fija.settlementDate !== cer.settlementDate) {
    throw new Error(
      `Las curvas no son de la misma rueda: tasa fija ${fija.tradeDate}, CER ${cer.tradeDate}.`,
    );
  }
  const warnings = [...fija.warnings, ...cer.warnings];

  const nominal = regresionLogaritmica(puntosDelAjuste(fija.instruments, 'tea'));
  const real = regresionLogaritmica(puntosDelAjuste(cer.instruments, 'tea'));
  if (!nominal || !real) throw new Error('No hay puntos suficientes para ajustar alguna de las curvas.');

  const liquidacion = parseIsoDate(cer.settlementDate);
  const fechaL = toIsoDate(restarDiasHabiles(liquidacion, CER_LAG_BUSINESS_DAYS));
  const [serie, ipc] = await Promise.all([fetchCer(fechaL), fetchIpcMensual()]);

  const cerEn = (fecha: IsoDate): number => {
    const v = serie.valor(fecha);
    if (v === null) throw new Error(`El BCRA no publicó el CER del ${fecha}.`);
    return v;
  };
  const L: CerPunto = { fecha: fechaL, valor: cerEn(fechaL) };

  // ── Inflación conocida ──
  // El último mes con IPC publicado y cuya ventana del CER ya está entera en
  // la serie: cierra el 15 de dos meses después y ese día tiene que estar.
  let ultimoConocido: string | null = null;
  for (const mes of [...ipc.keys()].sort()) {
    const fin = finDeVentana(mes);
    if (fin > L.fecha && serie.valor(fin) !== null) ultimoConocido = mes;
  }
  if (!ultimoConocido) throw new Error('No hay ningún mes con IPC y CER publicados después de L.');

  const conocidos: MesConocido[] = [];
  for (let mes = mesDeLaVentana(L.fecha); mes <= ultimoConocido; mes = sumarMeses(mes, 1)) {
    // El 15 anterior a la ventana: el CER justo antes de que empiece.
    const inicio = finDeVentana(sumarMeses(mes, -1));
    const desde = inicio < L.fecha ? L.fecha : inicio;
    conocidos.push({
      mes,
      ipcIndec: ipc.get(mes) ?? null,
      cer: cerEn(finDeVentana(mes)) / cerEn(desde) - 1,
      parcial: inicio < L.fecha,
    });
  }
  const finConocido = finDeVentana(ultimoConocido);
  const U: CerPunto = { fecha: finConocido, valor: cerEn(finConocido) };
  const acumuladaConocida = U.valor / L.valor - 1;

  /**
   * Lo que el mercado espera que crezca el CER entre L y una fecha, en
   * logaritmo: la diferencia entre las dos curvas leídas al largo de esa
   * ventana (ver arriba, "A qué plazo de la curva corresponde cada CER").
   */
  const crecimiento = (hasta: IsoDate) => {
    const dias = daysBetween(parseIsoDate(L.fecha), parseIsoDate(hasta));
    const n = nominal.evaluar(dias);
    const r = real.evaluar(dias);
    return { dias, n, r, log: (dias / DAY_COUNT_BASIS) * (Math.log1p(n) - Math.log1p(r)) };
  };
  const dentroDelRango = (dias: number) =>
    dias >= Math.max(nominal.desde, real.desde) && dias <= Math.min(nominal.hasta, real.hasta);

  const control = crecimiento(finConocido);

  // ── Forwards de mercado ──
  const ultimoIpc = ipc.get(ultimoConocido) ?? null;
  const meses: MesBreakeven[] = [];
  // Crecimiento acumulado desde L hasta el fin de la ventana anterior. El
  // primero es el CER real publicado, no la curva.
  let logAnterior = Math.log(U.valor / L.valor);
  for (let mes = sumarMeses(ultimoConocido, 1); ; mes = sumarMeses(mes, 1)) {
    const hasta = finDeVentana(mes);
    const c = crecimiento(hasta);
    // No se extrapola: el último mes es el último que las dos curvas cubren.
    if (!dentroDelRango(c.dias)) break;

    const desde = finDeVentana(sumarMeses(mes, -1));
    const largoVentana = daysBetween(parseIsoDate(desde), parseIsoDate(hasta));
    const logVentana = c.log - logAnterior;
    const inflacionMensual = Math.expm1((logVentana * DAYS_PER_MONTH) / largoVentana);
    const marcas: MarcaForward[] = [];
    if (inflacionMensual < 0) marcas.push('negativo');
    if (ultimoIpc !== null && inflacionMensual > FACTOR_ALTO * ultimoIpc) marcas.push('alto');
    meses.push({
      mes,
      ventana: { desde, hasta },
      fechaEvaluacion: toIsoDate(addDays(liquidacion, c.dias)),
      dias: c.dias,
      nominal: c.n,
      real: c.r,
      beAcumulado: Math.expm1(c.log),
      inflacionMensual,
      inflacionVentana: Math.expm1(logVentana),
      marcas,
    });
    logAnterior = c.log;
  }
  if (meses.length === 0) warnings.push('Las curvas no se superponen más allá de la inflación conocida.');

  const horas = [...fija.instruments, ...cer.instruments]
    .map((i) => i.dataTimestamp)
    .filter((h): h is string => h !== null)
    .sort();

  return {
    metodo: 'encadenado sobre curvas ajustadas',
    tradeDate: cer.tradeDate,
    session: cer.session,
    settlementDate: cer.settlementDate,
    fetchedAt: now.toISOString(),
    dataTimestamp: horas[horas.length - 1] ?? null,
    curvas: { nominal: resumen(nominal), real: resumen(real) },
    cer: { liquidacion: L, ultimoPublicado: U },
    conocida: {
      acumulada: acumuladaConocida,
      meses: conocidos,
      segunLaCurva: dentroDelRango(control.dias) ? Math.expm1(control.log) : null,
    },
    meses,
    warnings,
  };
}

function resumen({ a, b, r2, n, desde, hasta }: AjusteLogaritmico): AjusteResumen {
  return { a, b, r2, n, desde, hasta };
}

// ─── Meses INDEC y ventanas del CER ──────────────────────────────────────

/** 'YYYY-MM' desplazado `k` meses. */
function sumarMeses(mes: string, k: number): string {
  const [y, m] = mes.split('-').map(Number);
  const total = y * 12 + (m - 1) + k;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Último día de la ventana del CER que acumula el IPC del mes: el 15 de m+2. */
function finDeVentana(mes: string): IsoDate {
  return `${sumarMeses(mes, 2)}-15`;
}

/**
 * Mes INDEC de la ventana en la que cae el día siguiente a una fecha: desde
 * ahí empieza a correr el ajuste. Del 16 en adelante la ventana es la del mes
 * anterior; hasta el 15, la de dos meses antes.
 */
function mesDeLaVentana(fecha: IsoDate): string {
  const siguiente = toIsoDate(addDays(parseIsoDate(fecha), 1));
  const dia = Number(siguiente.slice(8, 10));
  return sumarMeses(siguiente.slice(0, 7), dia >= 16 ? -1 : -2);
}
