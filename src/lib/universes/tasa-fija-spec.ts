import type { BymaPanel } from '../sources/byma';

/**
 * Especificación del universo de tasa fija, compartida entre el runtime y el
 * script offline que regenera la referencia. Vive separada de la definición
 * del universo para que el script no arrastre el JSON generado.
 */

/** Las LECAPs están en `lebacs`, los BONCAPs en `public-bonds`. Hacen falta los dos. */
export const TASA_FIJA_PANELS: readonly BymaPanel[] = ['lebacs', 'public-bonds'];

/**
 * Tickers base del Tesoro en pesos.
 *
 * Los tickers base terminan siempre en el dígito del año de vencimiento
 * (S30N6, T15E7). Las variantes de la misma especie — otra moneda de
 * liquidación o settlement alternativo — terminan en letra (SN6D, SO6X,
 * TE7X, S2O6X) y comparten el ISIN con la base. Exigir que el último
 * carácter sea un dígito descarta todas las variantes de una.
 */
export const CANDIDATE_SYMBOL = /^[STM][A-Z0-9]{2,3}[0-9]$/;

/**
 * TEM de emisión para instrumentos cuya ficha técnica de BYMA no la informa
 * (el campo `interes` viene sin el porcentaje). Valores provistos y
 * confirmados por el usuario contra las condiciones de emisión.
 *
 * Los instrumentos resueltos por acá salen marcados con temSource 'manual'
 * en la respuesta del endpoint.
 */
export const MANUAL_ISSUE_TEM: Record<string, number> = {
  S13N6: 0.021,
  S15S6: 0.0199,
  S29E7: 0.0225,
};
