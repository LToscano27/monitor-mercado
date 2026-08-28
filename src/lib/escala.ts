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

/**
 * Marcas del eje de vencimientos: el primer día de cada mes calendario que
 * cae dentro del rango, expresado en días desde la liquidación.
 *
 * El eje es lineal en días, así que la separación entre marcas varía con el
 * largo real de cada mes. Eso es correcto y es parte de lo que el eje dice.
 */
export interface MarcaMes {
  dias: number;
  year: number;
  monthIndex: number;
}

export function marcasDeMeses(liquidacionIso: string, maxDias: number): MarcaMes[] {
  const [ly, lm, ld] = liquidacionIso.split('-').map(Number);
  const liquidacion = Date.UTC(ly, lm - 1, ld);
  const marcas: MarcaMes[] = [];

  let year = ly;
  let month = lm - 1;
  // Arranca en el primero del mes siguiente a la liquidación.
  month += 1;
  if (month > 11) {
    month = 0;
    year += 1;
  }

  for (let i = 0; i < 60; i += 1) {
    const dias = Math.round((Date.UTC(year, month, 1) - liquidacion) / 86_400_000);
    if (dias > maxDias) break;
    if (dias > 0) marcas.push({ dias, year, monthIndex: month });
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return marcas;
}

/**
 * Barra divergente: extremo redondeado del lado del dato, escuadra sobre la
 * línea de cero. `y0` es la base, `y1` la punta.
 */
export function barraDivergente(
  x: number,
  ancho: number,
  y0: number,
  y1: number,
  radio = 4,
): string {
  const izq = x - ancho / 2;
  const der = x + ancho / 2;
  const alto = Math.abs(y1 - y0);
  const r = Math.min(radio, ancho / 2, alto);
  if (alto < 0.5) return `M ${izq} ${y0} L ${der} ${y0}`;

  return y1 < y0
    ? // hacia arriba
      `M ${izq} ${y0} L ${izq} ${y1 + r} Q ${izq} ${y1} ${izq + r} ${y1}` +
        ` L ${der - r} ${y1} Q ${der} ${y1} ${der} ${y1 + r} L ${der} ${y0} Z`
    : // hacia abajo
      `M ${izq} ${y0} L ${izq} ${y1 - r} Q ${izq} ${y1} ${izq + r} ${y1}` +
        ` L ${der - r} ${y1} Q ${der} ${y1} ${der} ${y1 - r} L ${der} ${y0} Z`;
}
