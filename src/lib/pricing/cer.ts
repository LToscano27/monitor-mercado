import {
  CER_LAG_BUSINESS_DAYS,
  DAY_COUNT_BASIS,
  DAYS_PER_MONTH,
  daysBetween,
  parseIsoDate,
  restarDiasHabiles,
  toIsoDate,
} from '../conventions';
import type { SerieDiaria } from '../sources/bcra';
import type { CerDetalle, CerPunto, CerReference } from '../types';
import { cronograma } from '../universes/tasa-cer-condiciones';
import { FACE_VALUE } from './zero-coupon';

export interface CerValuation {
  daysToMaturity: number;
  /** Duration de Macaulay en días, a la TIR real. */
  durationDays: number;
  /** Rendimiento real, efectivo mensual. Puede ser negativo. */
  tem: number;
  /** Rendimiento real, efectivo anual. Puede ser negativo. */
  tea: number;
  cer: CerDetalle;
}

/** El CER que corresponde a una fecha según las condiciones de emisión. */
export function cerConRezago(fecha: Date, serie: SerieDiaria): CerPunto | null {
  const tomada = toIsoDate(restarDiasHabiles(fecha, CER_LAG_BUSINESS_DAYS));
  const valor = serie.valor(tomada);
  return valor === null ? null : { fecha: tomada, valor };
}

/**
 * Rendimiento real de un título ajustable por CER.
 *
 * Cada pago futuro vale su monto contractual por el ajuste CER de ese día,
 * que todavía no se conoce. No se lo estima: se mide todo en unidades del
 * CER de hoy, multiplicando cada flujo por CER(liq − 10) / CER(emisión − 10).
 * La tasa que iguala esos flujos reales con el precio es la TIR real:
 *
 *   precio = Σ 100 × flujo_i × K × CER(liq − 10)/CER(emi − 10) / (1 + TEA)^(días_i/365)
 *
 * con K el coeficiente de capitalización (1 salvo Discount y Cuasipar). En un
 * cero cupón hay un solo flujo y queda la fórmula cerrada de siempre,
 * (capitalAjustado / precio)^(365/días) − 1.
 *
 * Los días se cuentan de la liquidación a la fecha contractual de cada pago,
 * sin correrla al hábil siguiente: es lo que hace tasa fija con el
 * vencimiento, y las dos curvas se comparan punto a punto. El precio cotiza por cada 100 de VN original y
 * con el interés corrido incluido.
 *
 * Devuelve null si falta el precio, si no quedan pagos o si alguno de los
 * dos CER no está publicado. Nunca se completa un CER faltante.
 */
export function valuateCer(
  ref: CerReference,
  price: number | null,
  settlement: Date,
  serie: SerieDiaria,
): CerValuation | null {
  if (price === null || price <= 0) return null;
  const plan = cronograma(ref, settlement);
  if (!plan || plan.flujos.length === 0) return null;

  const emision = cerConRezago(parseIsoDate(ref.issueDate), serie);
  const liquidacion = cerConRezago(settlement, serie);
  if (!emision || !liquidacion) return null;

  const ajuste = (FACE_VALUE * plan.capitalizacion * liquidacion.valor) / emision.valor;
  const reales = plan.flujos.map((f) => ({
    dias: daysBetween(settlement, parseIsoDate(f.fecha)),
    monto: (f.amortizacion + f.interes) * ajuste,
  }));

  const tea = tir(price, reales);
  if (tea === null) return null;

  const vp = reales.map((f) => f.monto / (1 + tea) ** (f.dias / DAY_COUNT_BASIS));
  const total = vp.reduce((s, v) => s + v, 0);
  const durationDays = reales.reduce((s, f, i) => s + f.dias * vp[i], 0) / total;

  return {
    daysToMaturity: daysBetween(settlement, parseIsoDate(ref.maturityDate)),
    durationDays,
    tea,
    tem: (1 + tea) ** (DAYS_PER_MONTH / DAY_COUNT_BASIS) - 1,
    cer: {
      emision,
      liquidacion,
      coeficienteCapitalizacion: plan.capitalizacion,
      residual: plan.residual,
      capitalAjustado: plan.residual * ajuste,
      flujosRestantes: plan.flujos.length,
    },
  };
}

/**
 * TIR efectiva anual por bisección.
 *
 * El valor presente de flujos positivos cae siempre con la tasa, así que hay
 * una sola raíz y la bisección la encuentra sin depender de un punto de
 * partida. El rango admite tasas reales muy negativas, que en el tramo corto
 * son normales.
 */
function tir(precio: number, flujos: { dias: number; monto: number }[]): number | null {
  const vp = (tasa: number) =>
    flujos.reduce((s, f) => s + f.monto / (1 + tasa) ** (f.dias / DAY_COUNT_BASIS), 0);
  let bajo = -0.99;
  let alto = 10;
  if (vp(bajo) < precio || vp(alto) > precio) return null;
  for (let i = 0; i < 200; i += 1) {
    const medio = (bajo + alto) / 2;
    if (vp(medio) > precio) bajo = medio;
    else alto = medio;
    if (alto - bajo < 1e-12) break;
  }
  return (bajo + alto) / 2;
}
