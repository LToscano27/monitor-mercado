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

/** Los precios refrescan cada ~20s en la fuente; no tiene sentido pegarle más seguido. */
const CACHE_SECONDS = 20;
const STALE_WHILE_REVALIDATE_SECONDS = 60;

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
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE_SECONDS}`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'No se pudo construir el universo', detail: (err as Error).message },
      { status: 502 },
    );
  }
}
