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
 * Tickers base de los títulos CER.
 *
 *   TZX + mes + año      BONCER cero cupón        TZXO6, TZXD7, TZX27
 *   X + día + mes + año  LECER a descuento        X30S6, X29E7
 *   TX + año             BONCER con cupón         TX26, TX28, TX31
 *   TXM + mes + año      duales CER/TAMAR         TXMJ8, TXMD9
 *   los del canje        Discount, Par, Cuasipar  DICP, DIP0, PARP, PAP0, CUAP
 *
 * Como en tasa fija, las variantes de liquidación en otra moneda o plazo
 * (DICPD, DICPX, TXM7X) no son candidatas: son la misma especie. Los del
 * canje terminan en letra, así que van por nombre.
 *
 * La regex es un primer filtro; el que decide es la ficha, en
 * `tasa-cer-clasificador.ts`.
 */
export const CANDIDATE_SYMBOL =
  /^(TZX[A-Z0-9]{1,2}[0-9]|X[0-9]{2}[A-Z][0-9]|TX[0-9]{2}|TXM[A-Z][0-9]|DICP|DIP0|PARP|PAP0|CUAP)$/;
