import type { BymaFicha } from '../sources/byma';
import type { ZeroCouponReference } from '../types';
import { MANUAL_ISSUE_TEM } from './tasa-fija-spec';

/**
 * Decide si una especie pertenece al universo de tasa fija cero cupón y arma
 * su referencia a partir de la ficha técnica de BYMA.
 *
 * Vive acá y no en el script porque lo usan los dos: el script que regenera el
 * archivo versionado y el descubrimiento en caliente que incorpora especies
 * nuevas sin esperar a que alguien corra nada. Si la regla viviera duplicada,
 * una emisión nueva podría clasificarse distinto según quién la mire.
 */

export interface Clasificacion {
  esMiembro: boolean;
  /** Por qué no entra, cuando no entra. */
  motivo: string;
}

export function clasificar(ficha: BymaFicha): Clasificacion {
  const nombre = ficha.denominacion.toUpperCase();
  if (ficha.moneda !== 'Pesos') return { esMiembro: false, motivo: `moneda ${ficha.moneda}` };
  if (nombre.includes('TAMAR')) return { esMiembro: false, motivo: 'tasa variable TAMAR' };
  if (nombre.includes('CER')) return { esMiembro: false, motivo: 'ajustable por CER' };
  if (nombre.includes('DOLAR') || nombre.includes('DÓLAR')) {
    return { esMiembro: false, motivo: 'dólar linked' };
  }
  if (!nombre.includes('CAPITALIZABLE EN PESOS')) {
    return {
      esMiembro: false,
      motivo: 'no es cero cupón capitalizable (paga cupones o es otro tipo)',
    };
  }
  if (!/gobierno nacional/i.test(ficha.emisor)) {
    return { esMiembro: false, motivo: `emisor ${ficha.emisor}` };
  }
  return { esMiembro: true, motivo: '' };
}

/**
 * TEM de emisión, sacada del texto libre del campo `interes`.
 *
 * BYMA lo escribe de al menos tres formas distintas:
 *   "…\nTasa efectiva mensual: 2,53 %"
 *   "Pagarán una tasa efectiva mensual del 2.5% capitalizable…"
 *   "2,58%"
 *
 * En vez de encadenar regexes frágiles, se juntan todos los porcentajes del
 * texto, se filtran los que caen en un rango mensual plausible y se exige que
 * quede uno solo. Si queda ambiguo devuelve null: preferimos pedir el dato
 * antes que adivinarlo, porque un error acá corre toda la curva.
 */
const RANGO_MENSUAL_PLAUSIBLE = { min: 0.1, max: 15 };

export function parsearTemDeEmision(ficha: BymaFicha): number | null {
  const encontrados = [...ficha.interes.matchAll(/([\d]+(?:[.,][\d]+)?)\s*%/g)]
    .map((m) => Number(m[1].replace(',', '.')))
    .filter(
      (n) =>
        Number.isFinite(n) &&
        n >= RANGO_MENSUAL_PLAUSIBLE.min &&
        n <= RANGO_MENSUAL_PLAUSIBLE.max,
    );
  const distintos = [...new Set(encontrados)];
  return distintos.length === 1 ? distintos[0] / 100 : null;
}

/**
 * Arma la referencia de una especie a partir de su ficha. Devuelve null si no
 * pertenece al universo o si no se pudo establecer la TEM de emisión ni por
 * ficha ni por la tabla de overrides.
 */
export function referenciaDesdeFicha(ficha: BymaFicha): ZeroCouponReference | null {
  if (!clasificar(ficha).esMiembro) return null;

  const deFicha = parsearTemDeEmision(ficha);
  const issueTem = deFicha ?? MANUAL_ISSUE_TEM[ficha.symbol] ?? null;
  if (issueTem === null) return null;

  return {
    symbol: ficha.symbol,
    name: ficha.denominacion,
    isin: ficha.codigoIsin || null,
    issueDate: ficha.fechaEmision.slice(0, 10),
    maturityDate: ficha.fechaVencimiento.slice(0, 10),
    issueTem,
    temSource: deFicha !== null ? 'byma-ficha' : 'manual',
  };
}
