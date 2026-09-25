import {
  entraALaCurvaPorDefecto,
  puntosDelAjuste,
  regresionLogaritmica,
  type AjusteLogaritmico,
  type PuntoAjuste,
} from './ajuste';
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
import type { CerPunto, InstrumentRow } from './types';
import { tasaCer } from './universes/tasa-cer';
import { tasaFija } from './universes/tasa-fija';

/**
 * Inflación breakeven: la que iguala, a cada plazo, lo que paga una tasa fija
 * con lo que paga un CER.
 *
 * Método: encadenado sobre curvas ajustadas. No se compara bono contra bono
 * —los vencimientos no coinciden y el encadenado amplifica el ruido de cada
 * precio—, sino las dos curvas ajustadas (TEA = a + b·ln días, sólo cero
 * cupón) evaluadas en las mismas fechas. La real se ajusta sólo en el tramo
 * que cubre la nominal (ver `tramoComun`).
 *
 * Los pares que sí vencen el mismo día no se usan para calcular: se usan de
 * control. Su breakeven acumulado es exacto, y si la curva se aparta de él,
 * se marca.
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

/**
 * Control contra un par de títulos que vencen el mismo día: una LECAP o
 * BONCAP y un CER. Su breakeven acumulado es exacto —no pasa por ninguna
 * curva— y sirve para ver si el ajuste se aparta del mercado.
 */
export interface ControlPar {
  tasaFija: string;
  cer: string;
  vencimiento: IsoDate;
  /** Vencimiento − 10 hábiles: hasta dónde llega el CER que cobra el par. */
  cerHasta: IsoDate;
  /** Inflación acumulada de L a cerHasta según el par. */
  beAcumuladoPar: number;
  /** Lo mismo según las curvas. */
  beAcumuladoCurva: number;
  /**
   * Inflación mensual promedio (30 días) desde el último CER publicado hasta
   * cerHasta, según el par y según las curvas. Es la comparación que importa:
   * lo ya publicado es igual para los dos y diluiría la diferencia.
   */
  mensualPar: number;
  mensualCurva: number;
  /** Si la diferencia pasa el umbral. */
  seAparta: boolean;
}

export interface BreakevenResponse {
  metodo: 'encadenado sobre curvas ajustadas';
  /**
   * Rueda de cuyo cierre salen los precios: la última terminada. Con el
   * mercado abierto, la anterior a hoy.
   */
  tradeDate: IsoDate;
  settlementDate: IsoDate;
  fetchedAt: string;
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
  controles: ControlPar[];
  warnings: string[];
}

/** Umbral de "anómalamente alto": el doble del último IPC publicado. */
const FACTOR_ALTO = 2;

/**
 * Cuánto se puede apartar la curva de un par, en inflación mensual promedio,
 * antes de marcarlo: 0,10 puntos. Es del orden del sesgo que tenía el ajuste
 * CER cuando se hacía con toda la curva hasta 2029.
 */
const UMBRAL_CONTROL = 0.001;

/**
 * Horizonte mínimo, desde el último CER publicado, para que un par sirva de
 * control. Un par que cobra el CER de un día después de lo publicado mide la
 * inflación de ese único día: llevada a mes, cualquier centavo de precio la
 * vuelve absurda.
 */
const DIAS_MINIMOS_CONTROL = 20;

export async function buildBreakeven(now: Date = new Date()): Promise<BreakevenResponse> {
  // Con precios de cierre de la última rueda terminada: el breakeven es un
  // dato para leer una vez por día, y con precios en vivo se movería con cada
  // operación. Con la rueda abierta es el cierre de ayer; al cerrar el
  // mercado pasa solo al de hoy.
  //
  // Una curva después de la otra y no a la vez: fuera del panel, los cierres
  // salen de la serie histórica, un pedido por papel, y las dos juntas
  // duplicarían los pedidos simultáneos a BYMA. Con cierres no hay foto que
  // cuidar: son los mismos precios los pida quien los pida.
  const fija = await buildUniverse(tasaFija, now, 'cierre');
  const cer = await buildUniverse(tasaCer, now, 'cierre');
  if (fija.tradeDate !== cer.tradeDate || fija.settlementDate !== cer.settlementDate) {
    throw new Error(
      `Las curvas no son de la misma rueda: tasa fija ${fija.tradeDate}, CER ${cer.tradeDate}.`,
    );
  }
  const warnings = [...fija.warnings, ...cer.warnings];
  // Un cero cupón sin cierre sale de su curva, y eso cambia el breakeven.
  // Se avisa cuáles, para que un número raro tenga explicación.
  const sinCierre = [...fija.instruments, ...cer.instruments]
    .filter((i) => i.estructura === 'cero-cupon' && i.lastPrice === null)
    .map((i) => i.ticker);
  if (sinCierre.length > 0) {
    warnings.push(`Sin cierre en BYMA, fuera del ajuste: ${sinCierre.join(', ')}.`);
  }

  const nominal = regresionLogaritmica(puntosDelAjuste(fija.instruments, 'tea'));
  if (!nominal) throw new Error('No hay puntos suficientes para ajustar la curva de tasa fija.');
  const real = regresionLogaritmica(tramoComun(puntosDelAjuste(cer.instruments, 'tea'), nominal.hasta));
  if (!real) throw new Error('No hay puntos suficientes para ajustar la curva CER.');

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

  // ── Control contra pares del mismo vencimiento ──
  const logConocido = Math.log(U.valor / L.valor);
  const cerPorVencimiento = new Map(
    cer.instruments.filter(entraAlControl).map((i) => [i.maturityDate, i]),
  );
  const controles: ControlPar[] = [];
  for (const f of fija.instruments.filter(entraAlControl)) {
    const c = cerPorVencimiento.get(f.maturityDate);
    if (!c || f.tea === null || c.tea === null) continue;
    const cerHasta = toIsoDate(restarDiasHabiles(parseIsoDate(f.maturityDate), CER_LAG_BUSINESS_DAYS));
    const curva = crecimiento(cerHasta);
    const diasDesdeU = daysBetween(parseIsoDate(U.fecha), parseIsoDate(cerHasta));
    // Sólo donde hay algo que comparar: bastante después de lo publicado y
    // dentro de lo que cubren las curvas.
    if (diasDesdeU < DIAS_MINIMOS_CONTROL || !dentroDelRango(curva.dias)) continue;

    const logPar =
      (f.daysToMaturity / DAY_COUNT_BASIS) * (Math.log1p(f.tea) - Math.log1p(c.tea));
    const mensual = (log: number) =>
      Math.expm1(((log - logConocido) * DAYS_PER_MONTH) / diasDesdeU);
    const mensualPar = mensual(logPar);
    const mensualCurva = mensual(curva.log);
    controles.push({
      tasaFija: f.ticker,
      cer: c.ticker,
      vencimiento: f.maturityDate,
      cerHasta,
      beAcumuladoPar: Math.expm1(logPar),
      beAcumuladoCurva: Math.expm1(curva.log),
      mensualPar,
      mensualCurva,
      seAparta: Math.abs(mensualPar - mensualCurva) > UMBRAL_CONTROL,
    });
  }
  const apartados = controles.filter((c) => c.seAparta);
  if (apartados.length > 0) {
    warnings.push(
      `La curva se aparta más de ${(UMBRAL_CONTROL * 100).toFixed(2)} puntos mensuales de ${apartados
        .map((c) => `${c.tasaFija}/${c.cer}`)
        .join(', ')}.`,
    );
  }

  return {
    metodo: 'encadenado sobre curvas ajustadas',
    tradeDate: cer.tradeDate,
    settlementDate: cer.settlementDate,
    fetchedAt: now.toISOString(),
    curvas: { nominal: resumen(nominal), real: resumen(real) },
    cer: { liquidacion: L, ultimoPublicado: U },
    conocida: {
      acumulada: acumuladaConocida,
      meses: conocidos,
      segunLaCurva: dentroDelRango(control.dias) ? Math.expm1(control.log) : null,
    },
    meses,
    controles,
    warnings,
  };
}

function resumen({ a, b, r2, n, desde, hasta }: AjusteLogaritmico): AjusteResumen {
  return { a, b, r2, n, desde, hasta };
}

/**
 * Los puntos del ajuste real que caen en el tramo que cubre tasa fija, más
 * el primero que lo pasa.
 *
 * La curva CER llega hasta 2029 y la de tasa fija hasta unos nueve meses, y
 * el breakeven sólo se calcula donde están las dos. Si el ajuste real usa
 * también el tramo largo —reales del 10% a dos y tres años—, la forma
 * logarítmica se empina para alcanzarlos y queda uno o dos puntos por encima
 * de los papeles reales entre los cuatro y los doce meses, justo donde se
 * usa. Eso bajaba el breakeven unos 0,15 puntos por mes contra lo que dicen
 * los pares del mismo vencimiento.
 *
 * El papel de más es para que el borde del tramo quede cubierto por datos y
 * no por el extremo de la regresión, donde un ajuste es menos firme.
 */
function tramoComun(puntos: PuntoAjuste[], hasta: number): PuntoAjuste[] {
  const ordenados = [...puntos].sort((a, b) => a.dias - b.dias);
  const siguiente = ordenados.find((p) => p.dias > hasta);
  return ordenados.filter((p) => p.dias <= hasta || p === siguiente);
}

/** Los papeles que valen para el control por pares: la misma regla que el ajuste. */
function entraAlControl(i: InstrumentRow): boolean {
  return (
    i.estructura === 'cero-cupon' &&
    entraALaCurvaPorDefecto(i) &&
    i.quality.level === 'ok' &&
    i.tea !== null
  );
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
