import { memo } from '../cache';
import type { IsoDate } from '../conventions';

/**
 * API de Estadísticas Monetarias v4.0 del BCRA. Pública, sin key.
 *
 * De acá sale el CER, la única fuente oficial del coeficiente: es el BCRA el
 * que lo calcula y lo publica, y es contra esa publicación que el Tesoro
 * ajusta el capital de los títulos.
 */

const BASE = 'https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias';
const USER_AGENT = 'monitor-mercado/1.0 (+https://github.com/LToscano27/monitor-mercado)';
const REQUEST_TIMEOUT_MS = 8_000;

/** Coeficiente de Estabilización de Referencia, base 2/2/2002 = 1. */
const ID_CER = 30;

/**
 * La API devuelve como mucho 3000 filas por pedido. El CER es diario con fines
 * de semana incluidos, así que 3000 filas son más de ocho años: alcanza con un
 * solo pedido para cualquier título vivo.
 */
const LIMITE_FILAS = 3000;

/**
 * El CER se publica de a un mes por vez —cuando el INDEC da a conocer el IPC,
 * el BCRA fija los valores hasta el 15 del mes siguiente— y lo publicado no
 * cambia más. Una hora de cache es sobrada para no perderse una publicación
 * nueva y le ahorra a la API un pedido por request.
 */
const TTL_CER_MS = 60 * 60_000;

export interface SerieDiaria {
  /** Valor publicado para una fecha, o null si no hay publicación. */
  valor(fecha: IsoDate): number | null;
  /** Última fecha publicada. El CER llega hasta semanas adelante de hoy. */
  ultimaFecha: IsoDate | null;
}

interface RespuestaSerie {
  results?: { detalle?: { fecha: string; valor: number }[] }[];
}

/**
 * Serie del CER desde `desde` hasta lo último publicado.
 *
 * No se pide un `Hasta`: el CER ya está publicado hacia adelante hasta el 15
 * del mes próximo y conviene tenerlo todo, pero nunca se lo usa más allá de
 * lo publicado. Lo que no está no se estima.
 */
export function fetchCer(desde: IsoDate, signal?: AbortSignal): Promise<SerieDiaria> {
  return memo(`bcra:cer:${desde}`, TTL_CER_MS, () => traerSerie(ID_CER, desde, signal));
}

async function traerSerie(
  id: number,
  desde: IsoDate,
  signal?: AbortSignal,
): Promise<SerieDiaria> {
  const query = new URLSearchParams({ Desde: desde, Limit: String(LIMITE_FILAS) });
  const res = await fetch(`${BASE}/${id}?${query}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`BCRA variable ${id} respondió ${res.status}`);

  const payload = (await res.json()) as RespuestaSerie;
  const filas = payload.results?.[0]?.detalle ?? [];
  if (filas.length === 0) throw new Error(`BCRA variable ${id} vino vacía desde ${desde}`);

  const porFecha = new Map(filas.map((f) => [f.fecha.slice(0, 10), f.valor]));
  const fechas = [...porFecha.keys()].sort();
  return {
    valor: (fecha) => porFecha.get(fecha) ?? null,
    ultimaFecha: fechas[fechas.length - 1] ?? null,
  };
}
