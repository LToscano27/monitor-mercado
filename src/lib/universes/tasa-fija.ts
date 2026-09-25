import { CONVENTIONS_META } from '../conventions';
import { DEFAULT_THRESHOLDS } from '../quality';
import { reglasTasaFija } from './tasa-fija-clasificador';
import { descubrirPorFicha } from './descubrimiento';
import { valuate } from '../pricing/zero-coupon';
import type { ZeroCouponReference } from '../types';
import type { UniverseDefinition } from './types';
import { CANDIDATE_SYMBOL, TASA_FIJA_PANELS } from './tasa-fija-spec';
import referenceData from '../reference/tasa-fija.json' with { type: 'json' };

const reference = new Map<string, ZeroCouponReference>(
  (referenceData.instruments as ZeroCouponReference[]).map((r) => [r.symbol, r]),
);

const knownNonMembers = new Map<string, string>(
  referenceData.nonMembers.map((n) => [n.symbol, n.reason]),
);

export const tasaFija: UniverseDefinition<ZeroCouponReference> = {
  slug: 'tasa-fija',
  label: 'Tasa fija',
  description:
    'LECAPs y BONCAPs del Tesoro Nacional: cero cupón en pesos, capitalizables, íntegros al vencimiento.',
  bymaPanels: TASA_FIJA_PANELS,
  vista: { tituloCurva: 'Curva de tasa fija', ejeX: 'vencimiento', breakeven: false },
  candidateSymbol: CANDIDATE_SYMBOL,
  thresholds: DEFAULT_THRESHOLDS,
  conventions: CONVENTIONS_META,
  reference,
  knownNonMembers,
  unresolved: referenceData.unresolved,
  valuate: (ref, _quote, price, settlement) => valuate(ref, price, settlement),

  descubrir: (simbolos, signal) => descubrirPorFicha(simbolos, reglasTasaFija, signal),
};
