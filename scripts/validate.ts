/**
 * Corre el pipeline completo sin levantar Next y muestra el resultado en una
 * tabla legible, para chequear a mano las TEM/TEA contra el mercado.
 *
 *   npm run validate                  -> tabla
 *   npm run validate -- --json        -> JSON crudo del endpoint
 *   npm run validate -- --universe=tasa-fija
 */
import { buildUniverse } from '../src/lib/build';
import { getUniverse, listUniverses } from '../src/lib/universes';

const args = process.argv.slice(2);
const wantJson = args.includes('--json');
const slug = args.find((a) => a.startsWith('--universe='))?.split('=')[1] ?? 'tasa-fija';

const pct = (v: number | null, d = 2) => (v === null ? '—' : (v * 100).toFixed(d));
const num = (v: number | null, d = 3) => (v === null ? '—' : v.toFixed(d));

const compactArs = new Intl.NumberFormat('es-AR', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const QUALITY_MARK = { ok: ' ', warn: '!', bad: 'X' } as const;

async function main() {
  const universe = getUniverse(slug);
  if (!universe) {
    console.error(`Universo desconocido: ${slug}`);
    console.error('Disponibles:', listUniverses().map((u) => u.slug).join(', '));
    process.exit(1);
  }

  const payload = await buildUniverse(universe);

  if (wantJson) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`\n${payload.label.toUpperCase()}  ·  universo "${payload.universe}"`);
  console.log(
    `rueda ${payload.tradeDate} (${payload.session})  ·  liquidación ${payload.settlementDate}  ·  fuente ${payload.source}`,
  );
  console.log(
    `convención ${payload.conventions.dayCountBasis}, ${payload.conventions.settlement}, capitalización ${payload.conventions.capitalization}`,
  );
  console.log(`consultado ${payload.fetchedAt}\n`);

  const header = [
    'Q'.padEnd(1),
    'TICKER'.padEnd(6),
    'VENCE'.padEnd(10),
    'D.VTO'.padStart(5),
    'PRECIO'.padStart(9),
    'VAR'.padStart(7),
    'VAR%'.padStart(7),
    'PAGO FIN'.padStart(9),
    'TEM%'.padStart(7),
    'TEA%'.padStart(7),
    'VOLUMEN'.padStart(9),
    'OPS'.padStart(6),
    'HORA'.padStart(9),
  ].join(' ');
  console.log(header);
  console.log('─'.repeat(header.length));

  for (const i of payload.instruments) {
    console.log(
      [
        QUALITY_MARK[i.quality.level],
        i.ticker.padEnd(6),
        i.maturityDate.padEnd(10),
        (String(i.daysToMaturity) + (i.settlementBasis === 'contado' ? '*' : '')).padStart(5),
        num(i.lastPrice).padStart(9),
        num(i.priceChange).padStart(7),
        (i.priceChangePct === null ? '—' : i.priceChangePct.toFixed(2)).padStart(7),
        num(i.finalPayment).padStart(9),
        pct(i.tem).padStart(8),
        pct(i.tea, 2).padStart(7),
        (() => {
          const v = i.volumeAmount ?? i.volumeNominal;
          return (v === null ? '—' : compactArs.format(v)).padStart(9);
        })(),
        (i.orderCount === null ? '—' : String(i.orderCount)).padStart(6),
        (i.lastTradeTime ?? '—').padStart(9),
      ].join(' '),
    );
  }

  const flagged = payload.instruments.filter((i) => i.quality.level !== 'ok');
  if (flagged.length > 0) {
    console.log('\nCALIDAD DEL DATO');
    for (const i of flagged) {
      console.log(`  ${QUALITY_MARK[i.quality.level]} ${i.ticker}`);
      for (const f of i.quality.flags) {
        console.log(`      [${f.level}] ${f.code}: ${f.message}`);
      }
    }
  }

  console.log('\nREFERENCIA (para verificar el pago al vencimiento a mano)');
  console.log(
    ['  TICKER'.padEnd(8), 'EMISIÓN'.padEnd(10), 'VENCE'.padEnd(10), 'TEM EMIS'.padStart(9), 'ORIGEN'.padStart(11)].join(' '),
  );
  for (const i of payload.instruments) {
    if (!i.reference) continue;
    console.log(
      [
        `  ${i.ticker}`.padEnd(8),
        i.reference.issueDate.padEnd(10),
        i.maturityDate.padEnd(10),
        `${(i.reference.issueTem * 100).toFixed(2)}%`.padStart(9),
        i.reference.temSource.padStart(11),
      ].join(' '),
    );
  }

  if (payload.warnings.length > 0) {
    console.log('\nWARNINGS DE UNIVERSO');
    for (const w of payload.warnings) console.log(`  · ${w}`);
  }
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
