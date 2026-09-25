import type { BymaFicha } from '../sources/byma';
import type { CerReference, Estructura } from '../types';
import type { ReglasDeDescubrimiento } from './descubrimiento';
import type { Clasificacion } from './tasa-fija-clasificador';
import { CONDICIONES_CER } from './tasa-cer-condiciones';

/**
 * Decide si una especie es un título del Tesoro ajustable por CER.
 *
 * La ficha de BYMA informa `moneda: "Pesos"` en todos los CER, así que la
 * moneda no distingue nada. Tampoco alcanza con la denominación: el Par y el
 * Cuasipar ("TITULOS PAR DENOMINADOS EN PESOS") no mencionan el CER en el
 * nombre, sólo en las condiciones. Se mira todo el texto de la ficha.
 */
export function clasificarCer(ficha: BymaFicha): Clasificacion {
  const texto = `${ficha.denominacion} ${ficha.formaAmortizacion} ${ficha.interes}`.toUpperCase();
  const ajustaPorCer = /\bCER\b|CERI\b|ESTABILIZACI[OÓ]N/.test(texto);
  if (!ajustaPorCer) return { esMiembro: false, motivo: 'no ajusta por CER' };
  if (!/gobierno nacional/i.test(ficha.emisor)) {
    return { esMiembro: false, motivo: `emisor ${ficha.emisor}` };
  }
  return { esMiembro: true, motivo: '' };
}

/** Cómo paga, leído de la denominación, que es el texto de la norma de emisión. */
export function estructuraCer(ficha: BymaFicha): Estructura {
  const nombre = ficha.denominacion.toUpperCase();
  if (nombre.includes('DUAL') || nombre.includes('TAMAR')) return 'dual';
  if (/CERO CUP[OÓ]N|A DESCUENTO/.test(nombre)) return 'cero-cupon';
  return 'con-cupon';
}

/**
 * Referencia de un CER. Los cero cupón y los duales se valúan con emisión y
 * vencimiento; los que pagan cupón necesitan además sus condiciones cargadas,
 * y sin ellas no se resuelven.
 */
export function referenciaCerDesdeFicha(ficha: BymaFicha): CerReference | null {
  if (!clasificarCer(ficha).esMiembro) return null;
  const emision = ficha.fechaEmision?.slice(0, 10);
  const vencimiento = ficha.fechaVencimiento?.slice(0, 10);
  if (!emision || !vencimiento) return null;
  const estructura = estructuraCer(ficha);
  if (estructura === 'con-cupon' && !CONDICIONES_CER[ficha.symbol]) return null;
  return {
    symbol: ficha.symbol,
    name: ficha.denominacion,
    isin: ficha.codigoIsin || null,
    issueDate: emision,
    maturityDate: vencimiento,
    estructura,
  };
}

export const reglasTasaCer: ReglasDeDescubrimiento<CerReference> = {
  clasificar: clasificarCer,
  resolver: async (ficha) => referenciaCerDesdeFicha(ficha),
  motivoSinResolver:
    'paga cupón y no tiene sus condiciones cargadas en CONDICIONES_CER, o la ficha no trae fechas',
};
