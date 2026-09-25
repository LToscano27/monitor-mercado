import type { BymaFicha } from '../sources/byma';
import type { CerReference } from '../types';
import type { ReglasDeDescubrimiento } from './descubrimiento';
import type { Clasificacion } from './tasa-fija-clasificador';

/**
 * Decide si una especie es un título del Tesoro cero cupón ajustable por CER.
 *
 * La ficha de BYMA informa `moneda: "Pesos"` en todos los CER, así que la
 * moneda no distingue nada: se decide por la denominación, que es el texto
 * de la norma de emisión y es consistente entre papeles.
 */
export function clasificarCer(ficha: BymaFicha): Clasificacion {
  const nombre = ficha.denominacion.toUpperCase();
  if (!nombre.includes('CER')) return { esMiembro: false, motivo: 'no ajusta por CER' };
  if (nombre.includes('TAMAR') || nombre.includes('DUAL')) {
    return { esMiembro: false, motivo: 'dual CER/TAMAR' };
  }
  // "CERO CUPÓN" en los BONCER, "A DESCUENTO" en las LECER. Un CER que no
  // diga ninguna de las dos paga cupón (TX26, TX28, TX31): necesita modelar
  // flujos y queda afuera hasta que se decida sumarlo.
  const ceroCupon = /CERO CUP[OÓ]N|A DESCUENTO/.test(nombre);
  if (!ceroCupon) return { esMiembro: false, motivo: 'CER con cupón' };
  if (!/gobierno nacional/i.test(ficha.emisor)) {
    return { esMiembro: false, motivo: `emisor ${ficha.emisor}` };
  }
  return { esMiembro: true, motivo: '' };
}

/**
 * Referencia de un CER cero cupón. A diferencia de tasa fija no hace falta
 * ninguna tasa: con emisión y vencimiento alcanza, el resto es el CER.
 */
export function referenciaCerDesdeFicha(ficha: BymaFicha): CerReference | null {
  if (!clasificarCer(ficha).esMiembro) return null;
  const emision = ficha.fechaEmision?.slice(0, 10);
  const vencimiento = ficha.fechaVencimiento?.slice(0, 10);
  if (!emision || !vencimiento) return null;
  return {
    symbol: ficha.symbol,
    name: ficha.denominacion,
    isin: ficha.codigoIsin || null,
    issueDate: emision,
    maturityDate: vencimiento,
  };
}

export const reglasTasaCer: ReglasDeDescubrimiento<CerReference> = {
  clasificar: clasificarCer,
  resolver: async (ficha) => referenciaCerDesdeFicha(ficha),
  motivoSinResolver: 'la ficha no trae fecha de emisión o de vencimiento',
};
