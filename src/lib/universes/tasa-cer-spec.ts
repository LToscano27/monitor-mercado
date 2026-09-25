import type { BymaPanel } from '../sources/byma';

/**
 * Especificación del universo CER, compartida entre el runtime y el script
 * que regenera la referencia.
 */

/**
 * Los BONCER cero cupón (TZX*) están en `public-bonds` y las LECER (X*) en
 * `lebacs`: son los mismos dos paneles que tasa fija. Que salgan del mismo
 * pedido es lo que después permite comparar las dos curvas sin que se cuele
 * una diferencia de horario entre fotos.
 */
export const TASA_CER_PANELS: readonly BymaPanel[] = ['lebacs', 'public-bonds'];

/**
 * Tickers base de los CER cero cupón.
 *
 *   TZX + mes + año   BONCER cero cupón     TZXO6, TZXD7, TZXM9
 *   TZX + año         BONCER cero cupón     TZX27, TZX28
 *   X + día + mes + año   LECER a descuento     X30S6, X29E7
 *
 * Como en tasa fija, el último carácter tiene que ser un dígito: descarta de
 * una las variantes de liquidación en otra moneda.
 *
 * Deja afuera a propósito los TX (TX26, TX28, TX31: pagan cupón y amortizan)
 * y los TXM (duales CER/TAMAR). La regex es un primer filtro; el que decide es
 * la ficha, en `tasa-cer-clasificador.ts`.
 */
export const CANDIDATE_SYMBOL = /^(TZX[A-Z0-9]{1,2}[0-9]|X[0-9]{2}[A-Z][0-9])$/;
