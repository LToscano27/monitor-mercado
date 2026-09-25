import {
  CER_LAG_BUSINESS_DAYS,
  daysBetween,
  effectiveAnnualRate,
  effectiveMonthlyRate,
  parseIsoDate,
  restarDiasHabiles,
  toIsoDate,
} from '../conventions';
import type { SerieDiaria } from '../sources/bcra';
import type { CerDetalle, CerReference } from '../types';
import { FACE_VALUE } from './zero-coupon';

export interface CerValuation {
  daysToMaturity: number;
  /** Rendimiento real, efectivo mensual. Puede ser negativo. */
  tem: number;
  /** Rendimiento real, efectivo anual. Puede ser negativo. */
  tea: number;
  cer: CerDetalle;
}

/** El CER que corresponde a una fecha según las condiciones de emisión. */
export function cerConRezago(fecha: Date, serie: SerieDiaria): { fecha: string; valor: number } | null {
  const tomada = toIsoDate(restarDiasHabiles(fecha, CER_LAG_BUSINESS_DAYS));
  const valor = serie.valor(tomada);
  return valor === null ? null : { fecha: tomada, valor };
}

/**
 * Rendimiento real de un cero cupón ajustable por CER.
 *
 * El título paga al vencimiento VN × CER(vto − 10) / CER(emisión − 10). Ese
 * CER final todavía no existe, así que no se lo estima: se mide todo en
 * unidades del CER de hoy. El capital ajustado a la liquidación es lo que
 * vale hoy el pago final en términos reales, y el rendimiento real es el que
 * lleva del precio a ese capital en los días que faltan.
 *
 *   capitalAjustado = 100 × CER(liq − 10) / CER(emisión − 10)
 *   TEA real        = (capitalAjustado / precio)^(365/días) − 1
 *
 * Los días se cuentan de la liquidación al vencimiento, con la misma
 * convención que tasa fija. El precio cotiza por cada 100 de VN original, no
 * sobre el capital ajustado.
 *
 * Devuelve null si falta el precio, si ya venció o si alguno de los dos CER
 * no está publicado. Nunca se completa un CER faltante.
 */
export function valuateCer(
  ref: CerReference,
  price: number | null,
  settlement: Date,
  serie: SerieDiaria,
): CerValuation | null {
  if (price === null || price <= 0) return null;
  const maturity = parseIsoDate(ref.maturityDate);
  const daysToMaturity = daysBetween(settlement, maturity);
  if (daysToMaturity <= 0) return null;

  const emision = cerConRezago(parseIsoDate(ref.issueDate), serie);
  const liquidacion = cerConRezago(settlement, serie);
  if (!emision || !liquidacion) return null;

  const capitalAjustado = (FACE_VALUE * liquidacion.valor) / emision.valor;
  return {
    daysToMaturity,
    tem: effectiveMonthlyRate(price, capitalAjustado, daysToMaturity),
    tea: effectiveAnnualRate(price, capitalAjustado, daysToMaturity),
    cer: { emision, liquidacion, capitalAjustado },
  };
}
