import { NextResponse } from 'next/server';
import { buildBreakeven } from '@/lib/breakeven';

/**
 * Inflación breakeven, calculada entera en el backend: arma las dos curvas
 * con la misma foto de BYMA, trae el CER del BCRA y el IPC del INDEC, y
 * devuelve los forwards por mes INDEC. El cliente sólo dibuja.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Dos universos, el CER y el IPC: más pedidos que una curva sola. */
export const maxDuration = 45;

/** Mismo criterio que las curvas: corto en rueda, un poco más con el mercado cerrado. */
const CACHE_EN_RUEDA = 20;
const CACHE_CERRADO = 60;
const STALE_WHILE_REVALIDATE = 60;

export async function GET() {
  try {
    const payload = await buildBreakeven();
    const maxAge = payload.session === 'cierre' ? CACHE_CERRADO : CACHE_EN_RUEDA;
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': `public, s-maxage=${maxAge}, stale-while-revalidate=${STALE_WHILE_REVALIDATE}`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'No se pudo calcular el breakeven', detail: (err as Error).message },
      { status: 502 },
    );
  }
}
