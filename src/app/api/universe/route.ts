import { NextResponse } from 'next/server';
import { listUniverses } from '@/lib/universes';

export const runtime = 'nodejs';

/** Catálogo de universos disponibles. */
export async function GET() {
  return NextResponse.json({ universes: listUniverses() });
}
