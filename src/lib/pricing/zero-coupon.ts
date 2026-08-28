import {
  capitalizationExponent,
  daysBetween,
  effectiveAnnualRate,
  effectiveMonthlyRate,
  parseIsoDate,
} from '../conventions';
import type { ZeroCouponReference } from '../types';

/** Valor nominal de referencia sobre el que cotizan LECAPs y BONCAPs. */
export const FACE_VALUE = 100;

export interface ZeroCouponValuation {
  /** Monto que paga el instrumento al vencimiento por cada 100 de VN. */
  finalPayment: number;
  daysToMaturity: number;
  tem: number;
  tea: number;
}

/**
 * Monto a cobrar al vencimiento de una LECAP/BONCAP.
 *
 * Son cero cupón capitalizables: NO pagan 100 al vencimiento, pagan el valor
 * nominal capitalizado a la TEM de emisión desde la fecha de emisión. Sin
 * este monto no hay rendimiento posible, y ninguna fuente de precios lo trae.
 */
export function finalPayment(ref: ZeroCouponReference): number {
  const issue = parseIsoDate(ref.issueDate);
  const maturity = parseIsoDate(ref.maturityDate);
  return FACE_VALUE * (1 + ref.issueTem) ** capitalizationExponent(issue, maturity);
}

/**
 * Rendimiento de un cero cupón. Los días se cuentan desde la fecha de
 * liquidación T+1, no desde hoy: en instrumentos cortos la diferencia es
 * visible.
 *
 * Devuelve null si el instrumento ya venció o si no hay precio.
 */
export function valuate(
  ref: ZeroCouponReference,
  price: number | null,
  settlement: Date,
): ZeroCouponValuation | null {
  if (price === null || price <= 0) return null;
  const maturity = parseIsoDate(ref.maturityDate);
  const daysToMaturity = daysBetween(settlement, maturity);
  if (daysToMaturity <= 0) return null;

  const payment = finalPayment(ref);
  return {
    finalPayment: payment,
    daysToMaturity,
    tem: effectiveMonthlyRate(price, payment, daysToMaturity),
    tea: effectiveAnnualRate(price, payment, daysToMaturity),
  };
}
