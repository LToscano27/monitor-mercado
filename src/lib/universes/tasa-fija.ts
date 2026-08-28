import { DEFAULT_THRESHOLDS } from '../quality';
import { valuate } from '../pricing/zero-coupon';
import type { ZeroCouponReference } from '../types';
import type { UniverseDefinition } from './types';
import { TASA_FIJA_FEEDS, TASA_FIJA_PANELS } from './tasa-fija-spec';
import referenceData from '../reference/tasa-fija.json' with { type: 'json' };

const reference = new Map<string, ZeroCouponReference>(
  (referenceData.instruments as ZeroCouponReference[]).map((r) => [r.symbol, r]),
);

const knownNonMembers = new Map<string, string>(
  referenceData.nonMembers.map((n) => [n.symbol, n.reason]),
);

export const tasaFija: UniverseDefinition = {
  slug: 'tasa-fija',
  label: 'Tasa fija',
  description:
    'LECAPs y BONCAPs del Tesoro Nacional: cero cupón en pesos, capitalizables, íntegros al vencimiento.',
  bymaPanels: TASA_FIJA_PANELS,
  data912Feeds: TASA_FIJA_FEEDS,
  thresholds: DEFAULT_THRESHOLDS,
  reference,
  knownNonMembers,
  unresolved: referenceData.unresolved,
  valuate: (ref, _quote, price, settlement) => valuate(ref, price, settlement),
};
