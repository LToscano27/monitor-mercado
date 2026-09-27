/**
 * Guarda la foto de cierre de cada curva en public/historico/.
 *
 *   npm run historico:guardar
 *
 * Toma los cierres de la última rueda terminada —con el mercado abierto, la
 * de ayer—, así que correrlo dos veces el mismo día, o un feriado, reescribe
 * la misma foto y no suma nada. Lo corre GitHub Actions todos los días hábiles
 * después del cierre (ver .github/workflows/guardar-cierre.yml).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildUniverse } from '../src/lib/build';
import { fotoDesde, type IndiceHistorico } from '../src/lib/historico';
import { tasaCer } from '../src/lib/universes/tasa-cer';
import { tasaFija } from '../src/lib/universes/tasa-fija';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '../public/historico');
const INDICE = join(DIR, 'indice.json');

/**
 * Menos de esto no es una curva: es una respuesta rota de la fuente. No se
 * guarda, para no dejar en la historia un día que después nadie puede
 * distinguir de uno real.
 */
const MINIMO_INSTRUMENTOS = 5;

async function main() {
  const indice: IndiceHistorico = existsSync(INDICE)
    ? JSON.parse(readFileSync(INDICE, 'utf8'))
    : {};

  // Una después de la otra: fuera del panel, los cierres son un pedido por
  // papel y juntas duplicarían los pedidos simultáneos a BYMA.
  for (const universo of [tasaFija, tasaCer]) {
    const respuesta = await buildUniverse(universo, new Date(), 'cierre');
    const foto = fotoDesde(respuesta);
    if (foto.instrumentos.length < MINIMO_INSTRUMENTOS) {
      throw new Error(
        `${universo.slug}: sólo ${foto.instrumentos.length} instrumentos con rendimiento el ${foto.tradeDate}; no se guarda.`,
      );
    }

    const carpeta = join(DIR, universo.slug);
    mkdirSync(carpeta, { recursive: true });
    writeFileSync(join(carpeta, `${foto.tradeDate}.json`), JSON.stringify(foto) + '\n');

    const fechas = new Set(indice[universo.slug] ?? []);
    fechas.add(foto.tradeDate);
    indice[universo.slug] = [...fechas].sort();
    console.log(`${universo.slug}: ${foto.tradeDate}, ${foto.instrumentos.length} instrumentos`);
  }

  writeFileSync(INDICE, JSON.stringify(indice, null, 1) + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
