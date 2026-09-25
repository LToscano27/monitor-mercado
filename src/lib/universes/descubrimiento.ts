import { estaCacheado, memo } from '../cache';
import { fetchFicha, type BymaFicha } from '../sources/byma';
import type { Clasificacion } from './tasa-fija-clasificador';

/**
 * Descubrimiento en caliente de especies nuevas, común a todos los universos.
 *
 * Lo que cambia entre curvas es cómo se decide si una ficha es del universo y
 * cómo se arma su referencia; el resto —el cache de fichas, el tope de
 * pedidos, qué hacer si la ficha no existe o no responde— es el mismo.
 */

/**
 * Una ficha técnica no cambia nunca. Se retiene un día entero para que una
 * especie nueva se resuelva una sola vez por instancia, y para que un ticker
 * que no pertenece al universo no se vuelva a consultar en cada request.
 */
const TTL_FICHA_MS = 24 * 60 * 60_000;

/**
 * Cuánto se espera antes de volver a preguntar por una ficha que todavía no
 * existe. Una letra recién licitada puede empezar a cotizar antes de que su
 * ficha esté publicada; con este reintento entra a la curva el mismo día.
 */
const TTL_FICHA_AUSENTE_MS = 10 * 60_000;

/**
 * Tope de fichas que se van a buscar a la red en un mismo request, para no
 * castigar a la fuente si aparecen varias especies juntas.
 *
 * Cuenta sólo las que no están en cache. Si contara todas, con más especies
 * nuevas que el tope las últimas nunca entrarían: el orden es estable, así que
 * serían siempre las mismas las que quedan afuera.
 */
const MAX_FICHAS_NUEVAS = 4;

/**
 * Cómo un universo reconoce a sus especies a partir de la ficha técnica. Lo
 * usan el descubrimiento en caliente y el script que regenera la referencia:
 * si la regla viviera duplicada, una emisión nueva podría clasificarse
 * distinto según quién la mire.
 */
export interface ReglasDeDescubrimiento<R> {
  clasificar(ficha: BymaFicha): Clasificacion;
  /**
   * Arma la referencia de una ficha que ya se sabe miembro. Null si falta
   * algún dato para valuarla; en ese caso se avisa con `motivoSinResolver`.
   */
  resolver(ficha: BymaFicha, signal?: AbortSignal): Promise<R | null>;
  motivoSinResolver: string;
}

export async function descubrirPorFicha<R>(
  simbolos: readonly string[],
  reglas: ReglasDeDescubrimiento<R>,
  signal?: AbortSignal,
): Promise<{ nuevas: R[]; sinResolver: { symbol: string; motivo: string }[] }> {
  const nuevas: R[] = [];
  const sinResolver: { symbol: string; motivo: string }[] = [];
  let pedidosALaRed = 0;

  for (const symbol of simbolos) {
    const clave = `ficha:${symbol}`;
    if (!estaCacheado(clave)) {
      if (pedidosALaRed >= MAX_FICHAS_NUEVAS) continue;
      pedidosALaRed += 1;
    }

    let ficha;
    try {
      ficha = await memo(
        clave,
        TTL_FICHA_MS,
        () => fetchFicha(symbol, signal),
        TTL_FICHA_AUSENTE_MS,
      );
    } catch (err) {
      sinResolver.push({ symbol, motivo: `error al pedir la ficha (${(err as Error).message})` });
      continue;
    }

    // Sin ficha no se puede decidir nada y no hay nada que alguien pueda
    // hacer al respecto, así que no se avisa: sería ruido permanente por un
    // ticker que ni siquiera se sabe de qué curva es. Se reintenta solo,
    // por el TTL corto de arriba.
    if (!ficha) continue;

    // Si pertenece a otra curva no es novedad ni problema: simplemente no es
    // de acá y se ignora en silencio.
    if (!reglas.clasificar(ficha).esMiembro) continue;

    const referencia = await reglas.resolver(ficha, signal);
    if (referencia) nuevas.push(referencia);
    // Es del universo pero no se puede valuar. Se avisa: alguien tiene que
    // enterarse para completarla a mano.
    else sinResolver.push({ symbol, motivo: reglas.motivoSinResolver });
  }
  return { nuevas, sinResolver };
}
