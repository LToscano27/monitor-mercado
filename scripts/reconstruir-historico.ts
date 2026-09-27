/**
 * Reconstruye fotos de cierre de días pasados con la serie histórica de BYMA.
 *
 *   npm run historico:reconstruir -- --desde=2026-09-16 --hasta=2026-09-24
 *   npm run historico:reconstruir -- --desde=... --pisar   (reescribe las que ya hay)
 *
 * Usa el mismo cálculo que la pantalla, con los cierres de cada día. La
 * limitación es la referencia: sólo están los papeles que la referencia
 * conoce, así que para días en los que vivía un papel que ya venció y salió
 * de ella, esa foto quedaría incompleta. El script no lo detecta solo: hay
 * que pedir rangos en los que el universo fuera el mismo, o sumar antes esos
 * papeles a la referencia.
 *
 * Por defecto no pisa una foto existente: la guardada el mismo día por el
 * proceso de cierre es la que se vio en pantalla y manda sobre cualquier
 * reconstrucción.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildUniverse } from '../src/lib/build';
import { addDays, isBusinessDay, parseIsoDate, toIsoDate } from '../src/lib/conventions';
import { fotoDesde, type IndiceHistorico } from '../src/lib/historico';
import { precargarSeries } from '../src/lib/sources/byma';
import { tasaCer } from '../src/lib/universes/tasa-cer';
import { tasaFija } from '../src/lib/universes/tasa-fija';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '../public/historico');
const INDICE = join(DIR, 'indice.json');
const MINIMO_INSTRUMENTOS = 5;

const arg = (nombre: string) =>
  process.argv.find((a) => a.startsWith(`--${nombre}=`))?.split('=')[1];

async function main() {
  const desde = arg('desde');
  const hasta = arg('hasta');
  const pisar = process.argv.includes('--pisar');
  if (!desde || !hasta) throw new Error('Faltan --desde=AAAA-MM-DD y --hasta=AAAA-MM-DD');

  const indice: IndiceHistorico = existsSync(INDICE) ? JSON.parse(readFileSync(INDICE, 'utf8')) : {};

  // Todas las series primero, despacio y con reintentos; después cada día se
  // arma sin tocar la red.
  const papeles = [tasaFija, tasaCer].flatMap((u) =>
    [...u.reference.values()].filter((r) => r.maturityDate > desde).map((r) => r.symbol),
  );
  console.log(`Bajando la serie de ${papeles.length} papeles…`);
  const fallidos = await precargarSeries(papeles);
  if (fallidos.length > 0) console.warn(`No se pudo bajar: ${fallidos.join(', ')}`);

  for (let d = parseIsoDate(desde); toIsoDate(d) <= hasta; d = addDays(d, 1)) {
    if (!isBusinessDay(d)) continue;
    const fecha = toIsoDate(d);

    for (const universo of [tasaFija, tasaCer]) {
      const archivo = join(DIR, universo.slug, `${fecha}.json`);
      if (existsSync(archivo) && !pisar) {
        console.log(`${fecha} ${universo.slug}: ya estaba`);
        continue;
      }
      const respuesta = await buildUniverse(universo, new Date(), { cierreDe: fecha });
      // Si ese día no hubo rueda, la serie devuelve la anterior: no se guarda
      // con una fecha que no es la suya.
      if (respuesta.tradeDate !== fecha) {
        console.log(`${fecha} ${universo.slug}: sin rueda (último cierre ${respuesta.tradeDate})`);
        continue;
      }
      // Un papel de la referencia que ese día vivía y no tiene cierre es un
      // hueco de la fuente, no un dato: la foto quedaría con una curva
      // distinta de la real. Mejor no guardarla y reintentar después.
      const sinCierre = respuesta.instruments.filter((i) => i.lastPrice === null).map((i) => i.ticker);
      if (sinCierre.length > 0) {
        console.warn(`${fecha} ${universo.slug}: sin cierre para ${sinCierre.join(', ')}; no se guarda`);
        continue;
      }
      const foto = fotoDesde(respuesta);
      if (foto.instrumentos.length < MINIMO_INSTRUMENTOS) {
        console.warn(`${fecha} ${universo.slug}: sólo ${foto.instrumentos.length} con rendimiento, no se guarda`);
        continue;
      }
      mkdirSync(dirname(archivo), { recursive: true });
      writeFileSync(archivo, JSON.stringify(foto) + '\n');
      indice[universo.slug] = [...new Set([...(indice[universo.slug] ?? []), fecha])].sort();
      console.log(`${fecha} ${universo.slug}: ${foto.instrumentos.length} instrumentos`);
    }
  }

  writeFileSync(INDICE, JSON.stringify(indice, null, 1) + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
