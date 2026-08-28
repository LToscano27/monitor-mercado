/**
 * Cache en memoria del proceso, con deduplicación de pedidos en vuelo.
 *
 * Existe para no castigar a la fuente. BYMA no publica su rate limit, pero lo
 * aplica: ante demasiados pedidos deja de completar el handshake TCP y los
 * paquetes se descartan en silencio — no devuelve 429 ni cierra la conexión,
 * así que desde afuera se parece a una caída. Recuperarse de eso lleva rato.
 *
 * Sin este cache, cada refresco de cada pestaña abierta disparaba una tanda
 * completa de pedidos: en la rama de cierre son 13 por vuelta.
 *
 * Vive en el proceso, así que en serverless dura lo que dure la instancia
 * caliente. No reemplaza al cache del CDN, lo complementa: el CDN corta el
 * tráfico entre el navegador y la función, esto corta el que va de la función
 * a la fuente.
 */

interface Entrada<T> {
  vence: number;
  valor: Promise<T>;
}

const entradas = new Map<string, Entrada<unknown>>();

/**
 * Cortacircuitos. Cuando la fuente empieza a fallar, seguir golpeándola es lo
 * peor que se puede hacer: si el motivo es un rate limit, cada reintento
 * renueva el bloqueo y no se sale más. Tras un fallo la clave queda en pausa
 * un rato y los pedidos fallan rápido, sin tocar la red.
 */
const PAUSA_TRAS_FALLO_MS = 45_000;
const enPausa = new Map<string, number>();

export async function memo<T>(
  clave: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const ahora = Date.now();

  const pausadaHasta = enPausa.get(clave);
  if (pausadaHasta !== undefined) {
    if (pausadaHasta > ahora) {
      const seg = Math.ceil((pausadaHasta - ahora) / 1000);
      throw new Error(`la fuente falló recién; se reintenta en ${seg} s`);
    }
    enPausa.delete(clave);
  }

  const previa = entradas.get(clave) as Entrada<T> | undefined;
  if (previa && previa.vence > ahora) return previa.valor;

  // Se guarda la promesa, no el resultado: dos pedidos simultáneos comparten
  // una sola llamada a la fuente en vez de dispararla dos veces.
  const valor = fn();
  entradas.set(clave, { vence: ahora + ttlMs, valor });

  try {
    return await valor;
  } catch (err) {
    // Un fallo no se cachea como dato, pero sí abre la pausa.
    if (entradas.get(clave)?.valor === valor) entradas.delete(clave);
    enPausa.set(clave, Date.now() + PAUSA_TRAS_FALLO_MS);
    throw err;
  }
}
