/**
 * Regenera src/lib/reference/tasa-fija.json a partir de la ficha técnica de
 * BYMA. Es un script offline: la referencia es estática y no tiene sentido
 * pedirla en cada request.
 *
 *   npm run refresh:reference
 *
 * Descubre candidatos en los paneles, los clasifica con la ficha y separa el
 * universo cero cupón tasa fija del resto. Los que no son miembros quedan
 * listados con el motivo, para que un ticker nuevo desconocido se distinga de
 * uno ya evaluado y descartado.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchFicha, fetchQuotes, type BymaFicha } from '../src/lib/sources/byma';
import { TASA_FIJA_PANELS, MANUAL_ISSUE_TEM, CANDIDATE_SYMBOL } from '../src/lib/universes/tasa-fija-spec';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../src/lib/reference/tasa-fija.json');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Pausa entre pedidos de ficha.
 *
 * Este script recorre ~50 candidatos de a uno. Con pausas cortas es la forma
 * más rápida de ganarse un bloqueo por IP de BYMA, que no avisa: deja de
 * completar el handshake TCP y tarda horas en soltar. Un segundo por pedido
 * son menos de dos minutos en total y no molesta a nadie.
 */
const PAUSA_MS = 1_000;

/**
 * Extrae la TEM de emisión del texto libre del campo `interes`.
 *
 * BYMA lo escribe de al menos tres formas distintas:
 *   "...
Tasa efectiva mensual: 2,53 %"
 *   "Pagarán una tasa efectiva mensual del 2.5% capitalizable..."
 *   "2,58%"
 * En vez de encadenar regexes frágiles, juntamos todos los porcentajes del
 * texto, nos quedamos con los que caen en un rango mensual plausible y
 * exigimos que quede uno solo. Si queda ambiguo devolvemos null y el ticker
 * cae al override manual: preferimos pedir el dato antes que adivinarlo.
 */
const PLAUSIBLE_MONTHLY_RANGE = { min: 0.1, max: 15 };

function parseIssueTem(ficha: BymaFicha): number | null {
  const found = [...ficha.interes.matchAll(/([\d]+(?:[.,][\d]+)?)\s*%/g)]
    .map((m) => Number(m[1].replace(',', '.')))
    .filter(
      (n) =>
        Number.isFinite(n) &&
        n >= PLAUSIBLE_MONTHLY_RANGE.min &&
        n <= PLAUSIBLE_MONTHLY_RANGE.max,
    );
  const distinct = [...new Set(found)];
  if (distinct.length !== 1) return null;
  return distinct[0] / 100;
}

function classify(ficha: BymaFicha): { member: boolean; reason: string } {
  const name = ficha.denominacion.toUpperCase();
  if (ficha.moneda !== 'Pesos') return { member: false, reason: `moneda ${ficha.moneda}` };
  if (name.includes('TAMAR')) return { member: false, reason: 'tasa variable TAMAR' };
  if (name.includes('CER')) return { member: false, reason: 'ajustable por CER' };
  if (name.includes('DOLAR') || name.includes('DÓLAR'))
    return { member: false, reason: 'dólar linked' };
  if (!name.includes('CAPITALIZABLE EN PESOS'))
    return { member: false, reason: 'no es cero cupón capitalizable (paga cupones o es otro tipo)' };
  if (!/gobierno nacional/i.test(ficha.emisor))
    return { member: false, reason: `emisor ${ficha.emisor}` };
  return { member: true, reason: '' };
}

async function main() {
  const quotes = await fetchQuotes(TASA_FIJA_PANELS);
  const candidates = [...quotes.keys()].filter((s) => CANDIDATE_SYMBOL.test(s)).sort();
  console.log(`${candidates.length} candidatos en los paneles ${TASA_FIJA_PANELS.join(', ')}`);

  const members: unknown[] = [];
  const nonMembers: unknown[] = [];
  const unresolved: string[] = [];

  for (const symbol of candidates) {
    let ficha: BymaFicha | null = null;
    try {
      ficha = await fetchFicha(symbol);
    } catch (err) {
      console.warn(`  ${symbol}: error de ficha (${(err as Error).message})`);
    }
    await sleep(PAUSA_MS);

    if (!ficha) {
      unresolved.push(symbol);
      continue;
    }
    const { member, reason } = classify(ficha);
    if (!member) {
      nonMembers.push({ symbol, name: ficha.denominacion, reason });
      continue;
    }

    const fromFicha = parseIssueTem(ficha);
    const manual = MANUAL_ISSUE_TEM[symbol];
    const issueTem = fromFicha ?? manual ?? null;
    if (issueTem === null) {
      console.warn(`  ${symbol}: sin TEM de emisión en la ficha y sin override manual`);
      unresolved.push(symbol);
      continue;
    }

    members.push({
      symbol,
      name: ficha.denominacion,
      isin: ficha.codigoIsin || null,
      issueDate: ficha.fechaEmision.slice(0, 10),
      maturityDate: ficha.fechaVencimiento.slice(0, 10),
      issueTem,
      temSource: fromFicha !== null ? 'byma-ficha' : 'manual',
    });
    console.log(`  ✓ ${symbol}  TEM emisión ${(issueTem * 100).toFixed(2)}%  (${fromFicha !== null ? 'ficha' : 'manual'})`);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    source: 'BYMA ficha técnica (bnown/fichatecnica/especies/general)',
    instruments: members,
    nonMembers,
    unresolved,
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log(`\n${members.length} instrumentos, ${nonMembers.length} descartados, ${unresolved.length} sin resolver`);
  console.log(`escrito en ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
