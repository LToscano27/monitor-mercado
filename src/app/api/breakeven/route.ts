import { NextResponse } from 'next/server';
import { AVISO_SIN_CIERRE, buildBreakeven } from '@/lib/breakeven';

/**
 * Inflación breakeven, calculada entera en el backend: arma las dos curvas
 * con los cierres de la última rueda terminada, trae el CER del BCRA y el
 * IPC del INDEC, y devuelve los forwards por mes INDEC. El cliente sólo
 * dibuja.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Dos universos uno después del otro, el CER y el IPC: más que una curva sola. */
export const maxDuration = 60;

/**
 * Sale de precios de cierre, así que cambia una vez por día. Diez minutos de
 * cache le ahorran a BYMA las series históricas de cuarenta papeles y, al
 * cerrar la rueda, el cálculo nuevo aparece a lo sumo diez minutos después.
 */
const CACHE_S = 600;
const STALE_WHILE_REVALIDATE = 600;
/**
 * Si a alguna curva le faltó un papel, la respuesta se retiene sólo un
 * minuto: un hueco pasajero de BYMA no puede quedar servido veinte.
 */
const CACHE_INCOMPLETO_S = 60;

export async function GET() {
  try {
    const payload = await buildBreakeven();
    const incompleto = payload.warnings.some((w) => w.startsWith(AVISO_SIN_CIERRE));
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': incompleto
          ? `public, s-maxage=${CACHE_INCOMPLETO_S}`
          : `public, s-maxage=${CACHE_S}, stale-while-revalidate=${STALE_WHILE_REVALIDATE}`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'No se pudo calcular el breakeven', detail: (err as Error).message },
      { status: 502 },
    );
  }
}
