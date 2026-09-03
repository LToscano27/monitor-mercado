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
import { TASA_FIJA_PANELS, CANDIDATE_SYMBOL } from '../src/lib/universes/tasa-fija-spec';
import { clasificar, referenciaDesdeFicha } from '../src/lib/universes/tasa-fija-clasificador';
import { temDeLicitacion } from '../src/lib/sources/finanzas';

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
    const { esMiembro, motivo } = clasificar(ficha);
    if (!esMiembro) {
      nonMembers.push({ symbol, name: ficha.denominacion, reason: motivo });
      continue;
    }

    // Misma cascada que en caliente: ficha, override manual y, si la ficha
    // vino sin la tasa, el resultado de la licitación que la adjudicó.
    let referencia = referenciaDesdeFicha(ficha);
    if (!referencia) {
      referencia = referenciaDesdeFicha(
        ficha,
        await temDeLicitacion(ficha.fechaVencimiento.slice(0, 10)),
      );
    }
    if (!referencia) {
      console.warn(`  ${symbol}: sin TEM de emisión por ficha, override ni licitación`);
      unresolved.push(symbol);
      continue;
    }

    members.push(referencia);
    console.log(
      `  ✓ ${symbol}  TEM emisión ${(referencia.issueTem * 100).toFixed(2)}%  (${referencia.temSource})`,
    );
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
