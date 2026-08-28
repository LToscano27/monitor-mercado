/**
 * Formateo para la interfaz. El backend entrega números crudos; acá se decide
 * cómo se leen. Ningún cálculo vive en este archivo.
 */

const MESES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

export const guion = '—';

export function pct(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return guion;
  return `${(value * 100).toFixed(digits)}%`;
}

export function pctPlano(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return guion;
  return `${value.toFixed(digits)}%`;
}

/** Signo menos tipográfico (−), no el guion ASCII: alinea con las cifras. */
export function pctFirmado(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return guion;
  const signo = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${signo}${Math.abs(value).toFixed(digits)}%`;
}

export function precio(value: number | null, digits = 3): string {
  if (value === null || !Number.isFinite(value)) return guion;
  return value.toLocaleString('es-AR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function numeroFirmado(value: number | null, digits = 3): string {
  if (value === null || !Number.isFinite(value)) return guion;
  const signo = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${signo}${Math.abs(value).toFixed(digits)}`;
}

export function entero(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return guion;
  return value.toLocaleString('es-AR');
}

/** Monto en pesos, compacto: 56,2 MM · 4,1 M · 272 k */
export function monto(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return guion;
  const abs = Math.abs(value);
  const fmt = (n: number, d: number) =>
    n.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
  if (abs >= 1e12) return `${fmt(value / 1e12, 1)} B`;
  if (abs >= 1e9) return `${fmt(value / 1e9, 1)} MM`;
  if (abs >= 1e6) return `${fmt(value / 1e6, 1)} M`;
  if (abs >= 1e3) return `${fmt(value / 1e3, 0)} k`;
  return fmt(value, 0);
}

/** '2026-11-13' -> '13 nov 26' */
export function fechaCorta(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MESES[m - 1]} ${String(y).slice(2)}`;
}

/** '2026-11-13' -> '13 de noviembre de 2026' */
export function fechaLarga(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const nombres = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  return `${d} de ${nombres[m - 1]} de ${y}`;
}

export function horaDeTimestamp(iso: string | null): string {
  if (!iso) return guion;
  return iso.slice(11, 19);
}
