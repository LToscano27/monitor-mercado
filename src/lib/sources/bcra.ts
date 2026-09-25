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
 * La API devuelve como mucho 3000 filas por pedido, unos ocho años de CER.
 * Los títulos del canje de 2005 toman su CER base de diciembre de 2003, así
 * que hacen falta tres o cuatro páginas. Se pagina por `Offset` hasta que una
 * vuelva incompleta.
 */
const LIMITE_FILAS = 3000;
/** Techo de páginas: más de 40 años de serie. Si se llega, algo cambió en la API. */
const MAX_PAGINAS = 5;

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
  const porFecha = new Map<string, number>();
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina += 1) {
    const filas = await traerPagina(id, desde, pagina * LIMITE_FILAS, signal);
    for (const f of filas) porFecha.set(f.fecha.slice(0, 10), f.valor);
    if (filas.length < LIMITE_FILAS) break;
  }
  if (porFecha.size === 0) throw new Error(`BCRA variable ${id} vino vacía desde ${desde}`);

  const fechas = [...porFecha.keys()].sort();
  return {
    valor: (fecha) => porFecha.get(fecha) ?? null,
    ultimaFecha: fechas[fechas.length - 1] ?? null,
  };
}

async function traerPagina(
  id: number,
  desde: IsoDate,
  offset: number,
  signal?: AbortSignal,
): Promise<{ fecha: string; valor: number }[]> {
  const query = new URLSearchParams({
    Desde: desde,
    Limit: String(LIMITE_FILAS),
    Offset: String(offset),
  });
  const res = await fetch(`${BASE}/${id}?${query}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`BCRA variable ${id} respondió ${res.status}`);
  const payload = (await res.json()) as RespuestaSerie;
  return payload.results?.[0]?.detalle ?? [];
}
