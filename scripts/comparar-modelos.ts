/**
 * Compara el breakeven con Nelson-Siegel y con el ajuste logarítmico sobre
 * las fotos guardadas en public/historico/, día por día.
 *
 *   npm run validate:modelos
 *
 * Imprime, para el último cierre, la inflación mensual y el control contra
 * pares con cada modelo y los parámetros de las curvas; y para toda la
 * historia, cuánto se aparta cada modelo de los pares y cuánto salta cada
 * mes de un día al siguiente.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModeloCurva } from '../src/lib/ajuste';
import {
  calcularBreakeven,
  desvioMedio,
  type CalculoBreakeven,
  type PapelBreakeven,
} from '../src/lib/breakeven';
import { addDays, parseIsoDate, toIsoDate } from '../src/lib/conventions';
import type { FotoCurva, IndiceHistorico } from '../src/lib/historico';
import { fetchCer } from '../src/lib/sources/bcra';
import { fetchIpcMensual } from '../src/lib/sources/indec';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '../public/historico');
const MODELOS: ModeloCurva[] = ['logaritmico', 'nelson-siegel'];
const NOMBRE: Record<ModeloCurva, string> = { logaritmico: 'LOG', 'nelson-siegel': 'NS' };

const pct = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined ? '—' : `${(v * 100).toFixed(d)}%`;
const pp = (v: number | null, d = 3) => (v === null ? '—' : (v * 100).toFixed(d));

function foto(universo: string, fecha: string): FotoCurva {
  return JSON.parse(readFileSync(join(DIR, universo, `${fecha}.json`), 'utf8'));
}

function papeles(f: FotoCurva): PapelBreakeven[] {
  return f.instrumentos.map((i) => ({ ...i, ok: i.calidad === 'ok' }));
}

async function main() {
  const indice: IndiceHistorico = JSON.parse(readFileSync(join(DIR, 'indice.json'), 'utf8'));
  const fechas = indice['tasa-fija'].filter((f) => indice['tasa-cer'].includes(f));
  // L de la primera foto es de diez hábiles antes: se pide con un mes de margen.
  const desde = toIsoDate(addDays(parseIsoDate(fechas[0]), -31));
  const [serie, ipc] = await Promise.all([fetchCer(desde), fetchIpcMensual()]);

  const dias = fechas.map((fecha) => {
    const fija = foto('tasa-fija', fecha);
    const cer = foto('tasa-cer', fecha);
    const porModelo = {} as Record<ModeloCurva, CalculoBreakeven | string>;
    for (const modelo of MODELOS) {
      try {
        porModelo[modelo] = calcularBreakeven({
          fija: papeles(fija),
          cer: papeles(cer),
          settlementDate: cer.settlementDate,
          serie,
          ipc,
          modelo,
        });
      } catch (err) {
        porModelo[modelo] = (err as Error).message;
      }
    }
    return { fecha, porModelo };
  });

  const ultimo = dias[dias.length - 1];
  console.log(`\n═══ ÚLTIMO CIERRE: ${ultimo.fecha} ═══`);

  console.log('\n1. INFLACIÓN MENSUAL POR MES INDEC (tasa de 30 días)');
  const ok = (m: ModeloCurva) =>
    typeof ultimo.porModelo[m] === 'string' ? null : (ultimo.porModelo[m] as CalculoBreakeven);
  const meses = [...new Set(MODELOS.flatMap((m) => ok(m)?.meses.map((x) => x.mes) ?? []))].sort();
  console.log(`  ${'MES'.padEnd(8)} ${'LOG'.padStart(8)} ${'NS'.padStart(8)} ${'NS−LOG'.padStart(8)}`);
  for (const mes of meses) {
    const [l, n] = MODELOS.map((m) => ok(m)?.meses.find((x) => x.mes === mes)?.inflacionMensual ?? null);
    console.log(
      `  ${mes.padEnd(8)} ${pct(l, 3).padStart(8)} ${pct(n, 3).padStart(8)} ${(l !== null && n !== null ? pp(n - l) : '—').padStart(8)}`,
    );
  }
  for (const m of MODELOS) {
    const r = ultimo.porModelo[m];
    if (typeof r === 'string') console.log(`  ${NOMBRE[m]}: ${r}`);
  }

  console.log('\n2. CONTROL CONTRA PARES (inflación mensual promedio; desvío en puntos)');
  const pares = ok('logaritmico')?.controles ?? [];
  console.log(
    `  ${'PAR'.padEnd(14)} ${'PAR'.padStart(8)} ${'LOG'.padStart(8)} ${'NS'.padStart(8)} ${'d LOG'.padStart(8)} ${'d NS'.padStart(8)}`,
  );
  for (const p of pares) {
    const n = ok('nelson-siegel')?.controles.find((c) => c.tasaFija === p.tasaFija);
    console.log(
      `  ${`${p.tasaFija}/${p.cer}`.padEnd(14)} ${pct(p.mensualPar, 3).padStart(8)} ${pct(p.mensualCurva, 3).padStart(8)} ${pct(n?.mensualCurva, 3).padStart(8)} ${pp(p.mensualCurva - p.mensualPar).padStart(8)} ${(n ? pp(n.mensualCurva - n.mensualPar) : '—').padStart(8)}`,
    );
  }

  console.log('\n4. PARÁMETROS DE LAS CURVAS');
  for (const m of MODELOS) {
    const r = ok(m);
    if (!r) continue;
    for (const [nombre, c] of Object.entries(r.curvas)) {
      const forma =
        c.modelo === 'nelson-siegel'
          ? `β0 ${pct(c.beta0, 2)}  β1 ${pct(c.beta1, 2)}  β2 ${pct(c.beta2, 2)}  τ ${c.tau.toFixed(0)} d (joroba a ${(c.tau * 1.7933).toFixed(0)} d)`
          : `a ${pct(c.a, 3)}  b ${pct(c.b, 3)}`;
      console.log(
        `  ${NOMBRE[m].padEnd(4)} ${nombre.padEnd(8)} ${forma}   R² ${c.r2.toFixed(3)}  n ${c.n}  días ${c.desde}–${c.hasta}`,
      );
    }
  }

  console.log('\n═══ HISTORIA ═══');
  console.log('\n3a. DESVÍO MEDIO CONTRA PARES POR DÍA (puntos mensuales)');
  console.log(`  ${'FECHA'.padEnd(11)} ${'LOG'.padStart(7)} ${'NS'.padStart(7)}  pares  τ nominal  τ real`);
  let sumaLog = 0;
  let sumaNs = 0;
  let conLosDos = 0;
  for (const d of dias) {
    const [l, n] = MODELOS.map((m) => d.porModelo[m]);
    const dl = typeof l === 'string' ? null : desvioMedio(l.controles);
    const dn = typeof n === 'string' ? null : desvioMedio(n.controles);
    const tau = (c: CalculoBreakeven | string, k: 'nominal' | 'real') => {
      if (typeof c === 'string') return '—';
      const x = c.curvas[k];
      return x.modelo === 'nelson-siegel' ? x.tau.toFixed(0) : '—';
    };
    if (dl !== null && dn !== null) {
      sumaLog += dl;
      sumaNs += dn;
      conLosDos += 1;
    }
    console.log(
      `  ${d.fecha.padEnd(11)} ${pp(dl).padStart(7)} ${pp(dn).padStart(7)}  ${String(typeof l === 'string' ? 0 : l.controles.length).padStart(5)}  ${tau(n, 'nominal').padStart(9)}  ${tau(n, 'real').padStart(6)}${typeof n === 'string' ? `   (${n})` : ''}`,
    );
  }
  if (conLosDos > 0) {
    console.log(
      `  ${'promedio'.padEnd(11)} ${pp(sumaLog / conLosDos).padStart(7)} ${pp(sumaNs / conLosDos).padStart(7)}`,
    );
  }

  for (const m of MODELOS) {
    console.log(`\n3b. INFLACIÓN MENSUAL DÍA A DÍA — ${NOMBRE[m]}`);
    const todos = [
      ...new Set(
        dias.flatMap((d) => {
          const r = d.porModelo[m];
          return typeof r === 'string' ? [] : r.meses.map((x) => x.mes);
        }),
      ),
    ].sort();
    console.log(`  ${'FECHA'.padEnd(11)} ${todos.map((x) => x.slice(2).padStart(7)).join(' ')}`);
    const serieMes: Record<string, number[]> = {};
    for (const d of dias) {
      const r = d.porModelo[m];
      const fila = todos.map((mes) => {
        const v = typeof r === 'string' ? null : (r.meses.find((x) => x.mes === mes)?.inflacionMensual ?? null);
        if (v !== null) (serieMes[mes] ??= []).push(v);
        return pct(v, 2).padStart(7);
      });
      console.log(`  ${d.fecha.padEnd(11)} ${fila.join(' ')}`);
    }
    // Salto diario: promedio del valor absoluto del cambio de un día al siguiente.
    const salto = todos.map((mes) => {
      const s = serieMes[mes] ?? [];
      if (s.length < 2) return '—'.padStart(7);
      let suma = 0;
      for (let i = 1; i < s.length; i += 1) suma += Math.abs(s[i] - s[i - 1]);
      return pp(suma / (s.length - 1), 2).padStart(7);
    });
    const maximo = todos.map((mes) => {
      const s = serieMes[mes] ?? [];
      let max = 0;
      for (let i = 1; i < s.length; i += 1) max = Math.max(max, Math.abs(s[i] - s[i - 1]));
      return s.length < 2 ? '—'.padStart(7) : pp(max, 2).padStart(7);
    });
    console.log(`  ${'salto med'.padEnd(11)} ${salto.join(' ')}   (puntos)`);
    console.log(`  ${'salto máx'.padEnd(11)} ${maximo.join(' ')}`);
  }
  console.log();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
