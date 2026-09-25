import { memo } from '../cache';

/**
 * IPC del INDEC, por la API de Series de Tiempo del Estado
 * (apis.datos.gob.ar). Pública, sin key.
 *
 * Es el dato que el breakeven no estima: los meses que el INDEC ya publicó
 * se muestran con su valor real, aparte de la expectativa de mercado.
 */

const URL_SERIES = 'https://apis.datos.gob.ar/series/api/series/';
const USER_AGENT = 'monitor-mercado/1.0 (+https://github.com/LToscano27/monitor-mercado)';
const REQUEST_TIMEOUT_MS = 8_000;

/** IPC Nacional, nivel general, variación mensual. Base diciembre 2016. */
const ID_IPC_MENSUAL = '145.3_INGNACUAL_DICI_M_38';

/** Se publica una vez por mes; seis horas de cache no se pierden nada. */
const TTL_IPC_MS = 6 * 60 * 60_000;

/** Variación mensual por mes, 'YYYY-MM' → decimal (0.017 = 1,7%). */
export type IpcMensual = ReadonlyMap<string, number>;

export function fetchIpcMensual(ultimos = 24, signal?: AbortSignal): Promise<IpcMensual> {
  return memo(`indec:ipc:${ultimos}`, TTL_IPC_MS, () => traer(ultimos, signal));
}

async function traer(ultimos: number, signal?: AbortSignal): Promise<IpcMensual> {
  const query = new URLSearchParams({ ids: ID_IPC_MENSUAL, last: String(ultimos), format: 'json' });
  const res = await fetch(`${URL_SERIES}?${query}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`INDEC series respondió ${res.status}`);
  const payload = (await res.json()) as { data?: [string, number | null][] };
  const meses = new Map<string, number>();
  for (const [fecha, valor] of payload.data ?? []) {
    if (valor !== null) meses.set(fecha.slice(0, 7), valor);
  }
  if (meses.size === 0) throw new Error('INDEC no devolvió datos de IPC');
  return meses;
}
