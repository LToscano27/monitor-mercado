/**
 * Convenciones de cálculo del mercado de renta fija en pesos.
 *
 * ESTE ES EL ÚNICO LUGAR donde viven las convenciones. Si una regla de
 * conteo de días, de liquidación o de anualización cambia, cambia acá y
 * en ningún otro archivo. Ningún módulo de pricing debe redefinirlas.
 */

/** Base de días para anualizar. Actual/365. */
export const DAY_COUNT_BASIS = 365;

/** Días por mes usados en la capitalización de LECAPs/BONCAPs. */
export const DAYS_PER_MONTH = 30;

/** Lag de liquidación del mercado local para renta fija en pesos: T+1. */
export const SETTLEMENT_LAG_BUSINESS_DAYS = 1;

/** Zona horaria del mercado local. */
export const MARKET_TIMEZONE = 'America/Argentina/Buenos_Aires';

/**
 * Feriados bursátiles ARS que caen en día hábil.
 * Hay que mantenerlo al día: un feriado faltante corre la fecha de
 * liquidación un día y mueve visiblemente la tasa de los papeles cortos.
 *
 * Los años cerrados no se escribieron de memoria: salen de cruzar dos
 * calendarios observados, los días en que BYMA publicó rueda para AL30 y los
 * días en que el BCRA publicó el mayorista de la Com. A 3500. Es feriado lo
 * que falta en los dos. Hacen falta por la curva CER: su capital se ajusta
 * con el CER de diez hábiles antes de la emisión, y hay papeles emitidos en
 * 2024. Antes de septiembre de 2024 BYMA no tiene serie y manda el BCRA.
 *
 * Los dos calendarios discrepan en días como el del bancario o los puentes
 * turísticos (2026-03-23, 2026-07-10): el BCRA no publica y BYMA opera. Acá
 * cuenta el mercado, que es el que liquida.
 */
export const MARKET_HOLIDAYS: readonly string[] = [
  // Ventanas sueltas, las justas para el CER base de los CER con cupón: diez
  // hábiles antes del 31/12/2003 (Discount, Par, Cuasipar), del 04/09/2020
  // (TX26, TX28) y del 31/05/2022 (TX31). Del BCRA, que es lo que hay para
  // esos años.
  '2003-12-08', '2003-12-25', '2020-08-17', '2022-05-18', '2022-05-25',
  // 2023 (sólo diciembre)
  '2023-12-08', '2023-12-25',
  // 2024
  '2024-01-01', '2024-02-12', '2024-02-13', '2024-03-28', '2024-03-29',
  '2024-04-01', '2024-04-02', '2024-05-01', '2024-06-17', '2024-06-20',
  '2024-06-21', '2024-07-09', '2024-10-11', '2024-11-18', '2024-12-25',
  '2024-12-31',
  // 2025
  '2025-01-01', '2025-03-03', '2025-03-04', '2025-03-24', '2025-04-02',
  '2025-04-17', '2025-04-18', '2025-05-01', '2025-05-02', '2025-06-16',
  '2025-06-20', '2025-07-09', '2025-08-15', '2025-10-10', '2025-11-24',
  '2025-12-08', '2025-12-25', '2025-12-31',
  // 2026
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-03-24', '2026-04-02',
  '2026-04-03', '2026-05-01', '2026-05-25', '2026-06-15', '2026-06-20',
  '2026-07-09', '2026-08-17', '2026-10-12', '2026-11-23', '2026-12-08',
  '2026-12-25',
  // 2027
  '2027-01-01', '2027-02-08', '2027-02-09', '2027-03-24', '2027-03-26',
  '2027-04-02', '2027-05-01', '2027-05-25', '2027-06-21', '2027-07-09',
  '2027-08-16', '2027-10-11', '2027-11-22', '2027-12-08', '2027-12-25',
];

const HOLIDAY_SET = new Set(MARKET_HOLIDAYS);

// ─── Fechas calendario (sin hora, sin timezone) ──────────────────────────
// Trabajamos con strings ISO 'YYYY-MM-DD' y UTC noon internamente para
// evitar que un cambio de huso corra un día.

export type IsoDate = string;

export function parseIsoDate(iso: IsoDate): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

export function toIsoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  const out = new Date(date.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

/** Días calendario entre dos fechas (actual). */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

export function isBusinessDay(date: Date): boolean {
  const dow = date.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !HOLIDAY_SET.has(toIsoDate(date));
}

/** Fecha calendario "hoy" en la plaza local, sin importar dónde corra el server. */
export function marketToday(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MARKET_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parseIsoDate(parts);
}

/**
 * Retraso con el que BYMA publica su feed gratuito.
 *
 * Medido cinco veces contra el reloj del propio servidor de BYMA: 20 min 22 s,
 * 20 min 53 s, 20 min 23 s, 20 min 54 s y 20 min 25 s. Constante, sin
 * tendencia a crecer; la oscilación de medio minuto es porque el feed se
 * actualiza en tandas de aproximadamente un minuto.
 */
export const FEED_DELAY_MS = 20 * 60_000;

/**
 * El momento al que corresponde todo lo que se muestra.
 *
 * Toda la pantalla vive corrida hacia atrás por el retraso del feed, así que
 * el estado de la rueda tiene que leerse con el mismo reloj. A las 17:05 de
 * hora real la foto es de las 16:45 y el mercado todavía está operando en lo
 * que se ve: los precios siguen cambiando hasta las 17:20 reales, cuando el
 * feed termina de publicar la última media hora de la rueda.
 */
export function momentoVisible(now: Date = new Date()): Date {
  return new Date(now.getTime() - FEED_DELAY_MS);
}

/**
 * Horario de rueda de la plaza local, en hora de Buenos Aires.
 *
 * Sirve para distinguir una rueda en curso de una ya cerrada. No alcanza con
 * mirar si el panel trae datos: BYMA conserva los de la rueda durante horas
 * después del cierre, y sin el horario esa foto se leería como si el mercado
 * siguiera abierto.
 */
export const TRADING_HOURS = { open: 11, close: 17 } as const;

export function isWithinTradingHours(now: Date = new Date()): boolean {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: MARKET_TIMEZONE,
    hour: '2-digit',
    hour12: false,
  }).format(now);
  const hora = Number(partes);
  if (!isBusinessDay(marketToday(now))) return false;
  return hora >= TRADING_HOURS.open && hora < TRADING_HOURS.close;
}

/**
 * Días hábiles entre dos fechas, sin contar la de partida.
 *
 * Es lo que dice cuánta vida operativa le queda a un papel: dos fechas a tres
 * días calendario pueden tener un solo hábil en el medio si hay fin de semana.
 */
export function businessDaysBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  let habiles = 0;
  let cursor = addDays(from, 1);
  while (cursor <= to) {
    if (isBusinessDay(cursor)) habiles += 1;
    cursor = addDays(cursor, 1);
  }
  return habiles;
}

/**
 * La fecha que está `n` días hábiles antes de otra.
 *
 * Es el rezago del CER: los papeles ajustables toman el coeficiente de diez
 * hábiles antes de la emisión, de la liquidación y del vencimiento.
 */
export function restarDiasHabiles(fecha: Date, n: number): Date {
  let cursor = fecha;
  let restantes = n;
  while (restantes > 0) {
    cursor = addDays(cursor, -1);
    if (isBusinessDay(cursor)) restantes -= 1;
  }
  return cursor;
}

/**
 * Fecha de liquidación T+1: el siguiente día hábil posterior a la rueda.
 * Si la rueda cae en día no hábil, primero se rolea al hábil anterior.
 */
export function settlementDate(tradeDate: Date): Date {
  let cursor = tradeDate;
  while (!isBusinessDay(cursor)) cursor = addDays(cursor, -1);
  let remaining = SETTLEMENT_LAG_BUSINESS_DAYS;
  while (remaining > 0) {
    cursor = addDays(cursor, 1);
    if (isBusinessDay(cursor)) remaining -= 1;
  }
  return cursor;
}

/**
 * Exponente de capitalización de un instrumento cero cupón capitalizable.
 *
 * Convención del Tesoro: meses calendario enteros entre emisión y
 * vencimiento, más el remanente de días dividido 30.
 *
 * NO es (días totales / 30). La diferencia es chica en el tramo largo pero
 * distorsiona fuerte el tramo corto: para S31G6 a 3 días de vencer, días/30
 * daba TEM 4,52% contra 1,97% con esta convención — un outlier inventado.
 */
export function capitalizationExponent(issue: Date, maturity: Date): number {
  let months =
    (maturity.getUTCFullYear() - issue.getUTCFullYear()) * 12 +
    (maturity.getUTCMonth() - issue.getUTCMonth());
  if (maturity.getUTCDate() < issue.getUTCDate()) months -= 1;

  const anchor = addMonthsClamped(issue, months);
  const remainderDays = daysBetween(anchor, maturity);
  return months + remainderDays / DAYS_PER_MONTH;
}

function addMonthsClamped(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const targetYear = y + Math.floor(m / 12);
  const targetMonth = ((m % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(targetYear, targetMonth, Math.min(date.getUTCDate(), lastDay), 12, 0, 0),
  );
}

/**
 * Días entre dos fechas en base 30/360 (convención US, la de los bonos
 * del Tesoro con cupón): un 31 cuenta como 30, y el 31 final sólo se corta
 * si el inicio ya era fin de mes.
 */
export function dias30360(desde: Date, hasta: Date): number {
  let d1 = desde.getUTCDate();
  let d2 = hasta.getUTCDate();
  if (d1 === 31) d1 = 30;
  if (d2 === 31 && d1 === 30) d2 = 30;
  return (
    (hasta.getUTCFullYear() - desde.getUTCFullYear()) * 360 +
    (hasta.getUTCMonth() - desde.getUTCMonth()) * 30 +
    (d2 - d1)
  );
}

// ─── Rendimientos ────────────────────────────────────────────────────────

/**
 * TEM — tasa efectiva mensual. Es como cotiza el mercado local.
 * Mes de 30 días sobre base actual/365 para el conteo al vencimiento.
 */
export function effectiveMonthlyRate(
  price: number,
  finalPayment: number,
  daysToMaturity: number,
): number {
  return (finalPayment / price) ** (DAYS_PER_MONTH / daysToMaturity) - 1;
}

/**
 * TEA — tasa efectiva anual. Actual/365.
 * Es consistente con la TEM por construcción: TEA = (1+TEM)^(365/30) - 1.
 */
export function effectiveAnnualRate(
  price: number,
  finalPayment: number,
  daysToMaturity: number,
): number {
  return (finalPayment / price) ** (DAY_COUNT_BASIS / daysToMaturity) - 1;
}

/**
 * Rezago del CER en los títulos ajustables del Tesoro.
 *
 * Lo fija cada emisión, y es el mismo en todas: el capital "será ajustado por
 * el CER informado por el BCRA, correspondiente al período transcurrido entre
 * los 10 días hábiles anteriores a la fecha de emisión y los 10 días hábiles
 * anteriores a la fecha de vencimiento". Textual de la ficha técnica de BYMA
 * de TZX27, X30N6 y XBF27.
 */
export const CER_LAG_BUSINESS_DAYS = 10;

/** Metadata de convenciones que viaja en la respuesta del endpoint. */
export const CONVENTIONS_META = {
  dayCountBasis: 'actual/365',
  settlement: 'T+1 hábil',
  daysPerMonth: DAYS_PER_MONTH,
  capitalization: 'meses calendario enteros + remanente/30',
  temDefinition: '(pagoFinal/precio)^(30/díasAlVencimiento) - 1',
  teaDefinition: '(pagoFinal/precio)^(365/díasAlVencimiento) - 1',
} as const;

/** Metadata de convenciones de la curva CER. */
export const CER_CONVENTIONS_META = {
  dayCountBasis: 'actual/365',
  settlement: 'T+1 hábil',
  daysPerMonth: DAYS_PER_MONTH,
  capitalization: `flujos × CER(liquidación − ${CER_LAG_BUSINESS_DAYS} hábiles) / CER(emisión − ${CER_LAG_BUSINESS_DAYS} hábiles)`,
  temDefinition: '(1 + TEA real)^(30/365) - 1',
  teaDefinition: 'TIR real: precio = Σ flujo ajustado / (1 + TEA)^(días/365); en un cero cupón, (capitalAjustado/precio)^(365/días) - 1',
} as const;

export type ConventionsMeta = typeof CONVENTIONS_META | typeof CER_CONVENTIONS_META;
