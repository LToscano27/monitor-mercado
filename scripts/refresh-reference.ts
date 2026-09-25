/**
 * Regenera la referencia estática de cada universo a partir de la ficha
 * técnica de BYMA. Es un script offline: la referencia es estática y no tiene
 * sentido pedirla en cada request.
 *
 *   npm run refresh:reference                        -> todos los universos
 *   npm run refresh:reference -- --universe=tasa-cer -> uno solo
 *
 * Descubre candidatos en los paneles, los clasifica con la ficha y separa los
 * miembros del resto. Los que no son miembros quedan listados con el motivo,
 * para que un ticker nuevo desconocido se distinga de uno ya evaluado y
 * descartado.
 *
 * Las reglas de clasificación son las mismas que usa el descubrimiento en
 * caliente (`ReglasDeDescubrimiento`): una sola fuente de verdad por universo.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchFicha, fetchQuotes, type BymaFicha, type BymaPanel } from '../src/lib/sources/byma';
import type { ReglasDeDescubrimiento } from '../src/lib/universes/descubrimiento';
import type { InstrumentReference, ZeroCouponReference } from '../src/lib/types';
import * as fija from '../src/lib/universes/tasa-fija-spec';
import * as cer from '../src/lib/universes/tasa-cer-spec';
import { reglasTasaFija } from '../src/lib/universes/tasa-fija-clasificador';
import { reglasTasaCer } from '../src/lib/universes/tasa-cer-clasificador';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/lib/reference');

interface Spec<R extends InstrumentReference> {
  slug: string;
  panels: readonly BymaPanel[];
  candidato: RegExp;
  reglas: ReglasDeDescubrimiento<R>;
  /** Lo que se imprime de cada miembro para revisar la corrida a ojo. */
  describir(ref: R): string;
}

const SPECS: Spec<InstrumentReference>[] = [
  {
    slug: 'tasa-fija',
    panels: fija.TASA_FIJA_PANELS,
    candidato: fija.CANDIDATE_SYMBOL,
    reglas: reglasTasaFija as ReglasDeDescubrimiento<InstrumentReference>,
    describir: (r) => {
      const z = r as ZeroCouponReference;
      return `TEM emisión ${(z.issueTem * 100).toFixed(2)}%  (${z.temSource})`;
    },
  },
  {
    slug: 'tasa-cer',
    panels: cer.TASA_CER_PANELS,
    candidato: cer.CANDIDATE_SYMBOL,
    reglas: reglasTasaCer,
    describir: (r) => `emisión ${r.issueDate}  vence ${r.maturityDate}`,
  },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Pausa entre pedidos de ficha.
 *
 * Este script recorre decenas de candidatos de a uno. Con pausas cortas es la
 * forma más rápida de ganarse un bloqueo por IP de BYMA, que no avisa: deja de
 * completar el handshake TCP y tarda horas en soltar. Un segundo por pedido
 * son un par de minutos en total y no molesta a nadie.
 */
const PAUSA_MS = 1_000;

/**
 * Las dos curvas comparten candidatos (un TZX calza en el patrón de tasa fija
 * y ahí se descarta por ser CER). Cada ficha se pide una sola vez por corrida.
 */
const fichas = new Map<string, BymaFicha | null>();
async function ficha(symbol: string): Promise<BymaFicha | null> {
  if (fichas.has(symbol)) return fichas.get(symbol)!;
  let f: BymaFicha | null = null;
  try {
    f = await fetchFicha(symbol);
  } catch (err) {
    console.warn(`  ${symbol}: error de ficha (${(err as Error).message})`);
  }
  await sleep(PAUSA_MS);
  fichas.set(symbol, f);
  return f;
}

async function refrescar(spec: Spec<InstrumentReference>) {
  const quotes = await fetchQuotes(spec.panels);
  const candidatos = [...quotes.keys()].filter((s) => spec.candidato.test(s)).sort();
  console.log(`\n[${spec.slug}] ${candidatos.length} candidatos en ${spec.panels.join(', ')}`);

  const members: InstrumentReference[] = [];
  const nonMembers: { symbol: string; name: string; reason: string }[] = [];
  const unresolved: string[] = [];

  for (const symbol of candidatos) {
    const f = await ficha(symbol);
    if (!f) {
      unresolved.push(symbol);
      continue;
    }
    const { esMiembro, motivo } = spec.reglas.clasificar(f);
    if (!esMiembro) {
      nonMembers.push({ symbol, name: f.denominacion, reason: motivo });
      continue;
    }
    const referencia = await spec.reglas.resolver(f);
    if (!referencia) {
      console.warn(`  ${symbol}: ${spec.reglas.motivoSinResolver}`);
      unresolved.push(symbol);
      continue;
    }
    members.push(referencia);
    console.log(`  ✓ ${symbol}  ${spec.describir(referencia)}`);
  }

  const archivo = join(DIR, `${spec.slug}.json`);
  const out = {
    generatedAt: new Date().toISOString(),
    source: 'BYMA ficha técnica (bnown/fichatecnica/especies/general)',
    instruments: members,
    nonMembers,
    unresolved,
  };
  writeFileSync(archivo, JSON.stringify(out, null, 2) + '\n');
  console.log(`${members.length} instrumentos, ${nonMembers.length} descartados, ${unresolved.length} sin resolver`);
  console.log(`escrito en ${archivo}`);
}

async function main() {
  const pedido = process.argv.find((a) => a.startsWith('--universe='))?.split('=')[1];
  const specs = pedido ? SPECS.filter((s) => s.slug === pedido) : SPECS;
  if (specs.length === 0) throw new Error(`Universo desconocido: ${pedido}`);
  for (const spec of specs) await refrescar(spec);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
