import { DEFAULT_THRESHOLDS } from '../quality';
import { fetchFicha } from '../sources/byma';
import { temDeLicitacion } from '../sources/finanzas';
import { estaCacheado, memo } from '../cache';
import { clasificar, referenciaDesdeFicha } from './tasa-fija-clasificador';
import { valuate } from '../pricing/zero-coupon';
import type { ZeroCouponReference } from '../types';
import type { UniverseDefinition } from './types';
import { TASA_FIJA_PANELS } from './tasa-fija-spec';
import referenceData from '../reference/tasa-fija.json' with { type: 'json' };

const reference = new Map<string, ZeroCouponReference>(
  (referenceData.instruments as ZeroCouponReference[]).map((r) => [r.symbol, r]),
);

const knownNonMembers = new Map<string, string>(
  referenceData.nonMembers.map((n) => [n.symbol, n.reason]),
);

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

export const tasaFija: UniverseDefinition = {
  slug: 'tasa-fija',
  label: 'Tasa fija',
  description:
    'LECAPs y BONCAPs del Tesoro Nacional: cero cupón en pesos, capitalizables, íntegros al vencimiento.',
  bymaPanels: TASA_FIJA_PANELS,
  thresholds: DEFAULT_THRESHOLDS,
  reference,
  knownNonMembers,
  unresolved: referenceData.unresolved,
  valuate: (ref, _quote, price, settlement) => valuate(ref, price, settlement),

  async descubrir(simbolos, signal) {
    const nuevas: ZeroCouponReference[] = [];
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

      // Si pertenece a otra curva —CER, TAMAR, dólar linked— no es novedad ni
      // problema: simplemente no es de acá y se ignora en silencio.
      if (!clasificar(ficha).esMiembro) continue;

      // Es del universo, pero puede que BYMA haya publicado la ficha sin la
      // tasa: pasa con casi toda letra recién emitida. Sin ese dato no hay
      // pago al vencimiento y por lo tanto no hay rendimiento, así que antes
      // de dejarla afuera se la busca en el resultado de la licitación que la
      // adjudicó, que es donde la publica el Tesoro.
      let referencia = referenciaDesdeFicha(ficha);
      if (!referencia) {
        const deLicitacion = await temDeLicitacion(ficha.fechaVencimiento.slice(0, 10), signal);
        referencia = referenciaDesdeFicha(ficha, deLicitacion);
      }

      if (referencia) nuevas.push(referencia);
      // No apareció por ningún lado. Se avisa para cargarla a mano: es el
      // único camino que queda y alguien tiene que enterarse.
      else sinResolver.push({ symbol, motivo: 'sin TEM de emisión; cargarla en MANUAL_ISSUE_TEM' });
    }
    return { nuevas, sinResolver };
  },
};
