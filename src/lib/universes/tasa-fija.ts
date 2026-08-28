import { DEFAULT_THRESHOLDS } from '../quality';
import { fetchFicha } from '../sources/byma';
import { memo } from '../cache';
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

/** Tope de fichas por request, para no castigar a la fuente si aparecen muchas. */
const MAX_DESCUBRIMIENTOS = 4;

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

    for (const symbol of simbolos.slice(0, MAX_DESCUBRIMIENTOS)) {
      let ficha;
      try {
        ficha = await memo(`ficha:${symbol}`, TTL_FICHA_MS, () => fetchFicha(symbol, signal));
      } catch (err) {
        sinResolver.push({ symbol, motivo: `error al pedir la ficha (${(err as Error).message})` });
        continue;
      }

      // Sin ficha no se puede decidir nada: puede ser una especie nueva del
      // universo o de cualquier otro. Se avisa en vez de suponer.
      if (!ficha) {
        sinResolver.push({ symbol, motivo: 'BYMA no publica ficha técnica' });
        continue;
      }

      // Si pertenece a otra curva —CER, TAMAR, dólar linked— no es novedad ni
      // problema: simplemente no es de acá y se ignora en silencio.
      if (!clasificar(ficha).esMiembro) continue;

      const referencia = referenciaDesdeFicha(ficha);
      if (referencia) nuevas.push(referencia);
      // Es del universo pero BYMA no publica su TEM de emisión: sin ese dato
      // no hay pago al vencimiento y no hay rendimiento posible. Se avisa
      // para cargarla a mano.
      else sinResolver.push({ symbol, motivo: 'sin TEM de emisión; cargarla en MANUAL_ISSUE_TEM' });
    }
    return { nuevas, sinResolver };
  },
};
