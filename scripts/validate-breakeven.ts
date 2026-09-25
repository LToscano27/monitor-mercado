/**
 * Corre el breakeven sin levantar Next e imprime la tabla por mes INDEC,
 * para chequear a mano cada tramo.
 *
 *   npm run validate:breakeven
 *   npm run validate:breakeven -- --json
 */
import { buildBreakeven } from '../src/lib/breakeven';

const pct = (v: number | null, d = 2) => (v === null ? '—' : `${(v * 100).toFixed(d)}%`);

async function main() {
  const be = await buildBreakeven();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(be, null, 2));
    return;
  }

  console.log(`\nBREAKEVEN  ·  ${be.metodo}`);
  console.log(
    `cierre de la rueda ${be.tradeDate}  ·  liquidación ${be.settlementDate}  ·  consultado ${be.fetchedAt}`,
  );
  for (const [nombre, c] of Object.entries(be.curvas)) {
    console.log(
      `  curva ${nombre.padEnd(7)} TEA = ${pct(c.a, 3)} + ${pct(c.b, 3)} · ln(d)   R² ${c.r2.toFixed(3)}   n ${c.n}   días ${c.desde}–${c.hasta}`,
    );
  }

  console.log(
    `\nINFLACIÓN CONOCIDA  CER ${be.cer.liquidacion.valor.toFixed(4)} (${be.cer.liquidacion.fecha}) → ${be.cer.ultimoPublicado.valor.toFixed(4)} (${be.cer.ultimoPublicado.fecha}) = ${pct(be.conocida.acumulada, 3)}`,
  );
  for (const m of be.conocida.meses) {
    console.log(
      `  IPC ${m.mes}  INDEC ${pct(m.ipcIndec, 3)}   en el CER ${pct(m.cer, 3)}${m.parcial ? '  (parcial: la ventana empezó antes de L)' : ''}`,
    );
  }
  console.log(`  la curva en ese mismo tramo diría ${pct(be.conocida.segunLaCurva, 3)} (sólo control)`);

  console.log('\nBREAKEVEN POR MES INDEC');
  const header = [
    'MES INDEC'.padEnd(9),
    'VENTANA CER'.padEnd(23),
    'EVALÚA'.padEnd(10),
    'DÍAS'.padStart(5),
    'NOMINAL'.padStart(8),
    'REAL'.padStart(7),
    'BE ACUM'.padStart(8),
    'VENTANA'.padStart(8),
    'MENSUAL'.padStart(8),
    '',
  ].join(' ');
  console.log(header);
  console.log('─'.repeat(header.length + 10));
  for (const m of be.meses) {
    console.log(
      [
        m.mes.padEnd(9),
        `${m.ventana.desde.slice(5)} → ${m.ventana.hasta}`.padEnd(23),
        m.fechaEvaluacion.padEnd(10),
        String(m.dias).padStart(5),
        pct(m.nominal).padStart(8),
        pct(m.real).padStart(7),
        pct(m.beAcumulado).padStart(8),
        pct(m.inflacionVentana, 3).padStart(8),
        pct(m.inflacionMensual, 3).padStart(8),
        m.marcas.length ? `  ⚠ ${m.marcas.join(', ')}` : '',
      ].join(' '),
    );
  }
  if (be.warnings.length) {
    console.log('\nWARNINGS');
    for (const w of be.warnings) console.log(`  · ${w}`);
  }
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
