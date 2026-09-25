import {
  CER_CONVENTIONS_META,
  CER_LAG_BUSINESS_DAYS,
  parseIsoDate,
  restarDiasHabiles,
  toIsoDate,
} from '../conventions';
import { DEFAULT_THRESHOLDS } from '../quality';
import { fetchCer, type SerieDiaria } from '../sources/bcra';
import { valuateCer } from '../pricing/cer';
import type { CerReference } from '../types';
import type { UniverseDefinition } from './types';
import { descubrirPorFicha } from './descubrimiento';
import { reglasTasaCer } from './tasa-cer-clasificador';
import { CANDIDATE_SYMBOL, TASA_CER_PANELS } from './tasa-cer-spec';
import referenceData from '../reference/tasa-cer.json' with { type: 'json' };

const reference = new Map<string, CerReference>(
  (referenceData.instruments as CerReference[]).map((r) => [r.symbol, r]),
);

const knownNonMembers = new Map<string, string>(
  (referenceData.nonMembers as { symbol: string; reason: string }[]).map((n) => [n.symbol, n.reason]),
);

export const tasaCer: UniverseDefinition<CerReference, SerieDiaria> = {
  slug: 'tasa-cer',
  label: 'CER',
  description:
    'Títulos del Tesoro ajustables por CER: BONCER y LECER cero cupón, bonos con cupón, Discount, Par, Cuasipar y duales CER/TAMAR.',
  bymaPanels: TASA_CER_PANELS,
  vista: { tituloCurva: 'Curva CER', ejeX: 'duration', breakeven: true },
  candidateSymbol: CANDIDATE_SYMBOL,
  thresholds: DEFAULT_THRESHOLDS,
  conventions: CER_CONVENTIONS_META,
  reference,
  knownNonMembers,
  unresolved: referenceData.unresolved as string[],

  /**
   * Un solo pedido al BCRA por request, desde el CER de emisión más viejo que
   * haga falta. Todos los CER que usa la valuación son de fechas pasadas —diez
   * hábiles antes de la emisión o de la liquidación—, así que siempre están
   * publicados.
   */
  prepararValuacion(vigentes, liquidacion, signal) {
    const fechas = vigentes.map((ref) => parseIsoDate(ref.issueDate));
    fechas.push(liquidacion);
    const primera = fechas.reduce((a, b) => (a < b ? a : b));
    return fetchCer(toIsoDate(restarDiasHabiles(primera, CER_LAG_BUSINESS_DAYS)), signal);
  },

  valuate(ref, _quote, price, settlement, serie) {
    if (!serie) return null;
    const v = valuateCer(ref, price, settlement, serie);
    return (
      v && {
        finalPayment: null,
        daysToMaturity: v.daysToMaturity,
        durationDays: v.durationDays,
        tem: v.tem,
        tea: v.tea,
        cer: v.cer,
      }
    );
  },

  descubrir: (simbolos, signal) => descubrirPorFicha(simbolos, reglasTasaCer, signal),
};
