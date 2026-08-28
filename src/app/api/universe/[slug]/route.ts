import { NextResponse } from 'next/server';
import { buildUniverse } from '@/lib/build';
import { getUniverse, listUniverses } from '@/lib/universes';

/**
 * Proxy server-side hacia la fuente de mercado.
 *
 * El frontend nunca le pega a BYMA ni a data912. Además del CORS, todos los
 * cálculos de rendimiento viven de este lado: el cliente recibe números
 * listos y sólo los dibuja.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** La rama de cierre son ~11 pedidos a la serie histórica de BYMA. */
export const maxDuration = 30;

/** En rueda los precios refrescan cada ~20s en la fuente. */
const CACHE_EN_RUEDA = 20;
/** Con el mercado cerrado los cierres ya no cambian: se cachean fuerte. */
const CACHE_CERRADO = 600;
const STALE_WHILE_REVALIDATE = 60;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const universe = getUniverse(slug);

  if (!universe) {
    return NextResponse.json(
      { error: `Universo desconocido: ${slug}`, available: listUniverses() },
      { status: 404 },
    );
  }

  try {
    const payload = await buildUniverse(universe);
    const maxAge = payload.session === 'cierre' ? CACHE_CERRADO : CACHE_EN_RUEDA;
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': `public, s-maxage=${maxAge}, stale-while-revalidate=${STALE_WHILE_REVALIDATE}`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'No se pudo construir el universo', detail: (err as Error).message },
      { status: 502 },
    );
  }
}
