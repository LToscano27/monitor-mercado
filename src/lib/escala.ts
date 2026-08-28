/** Utilidades de escala para los gráficos. Geometría, no finanzas. */

export interface EscalaLineal {
  (value: number): number;
  dominio: [number, number];
  rango: [number, number];
}

export function escalaLineal(
  dominio: [number, number],
  rango: [number, number],
): EscalaLineal {
  const [d0, d1] = dominio;
  const [r0, r1] = rango;
  const span = d1 - d0 || 1;
  const fn = ((value: number) => r0 + ((value - d0) / span) * (r1 - r0)) as EscalaLineal;
  fn.dominio = dominio;
  fn.rango = rango;
  return fn;
}

/**
 * Marcas redondeadas a números limpios dentro del dominio.
 * Devuelve entre 3 y 6 valores según el paso que salga más parejo.
 */
export function marcasLimpias(min: number, max: number, objetivo = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  const bruto = (max - min) / objetivo;
  const magnitud = 10 ** Math.floor(Math.log10(bruto));
  const normalizado = bruto / magnitud;
  const paso =
    (normalizado >= 5 ? 10 : normalizado >= 2 ? 5 : normalizado >= 1 ? 2 : 1) * magnitud;
  const inicio = Math.ceil(min / paso) * paso;
  const marcas: number[] = [];
  for (let v = inicio; v <= max + paso * 1e-6; v += paso) {
    marcas.push(Number(v.toFixed(10)));
  }
  return marcas;
}
