import type { UniverseDefinition } from './types';
import { tasaFija } from './tasa-fija';

/**
 * Registro de universos. Para sumar la curva CER o la de dólar linked:
 * generar su referencia, escribir su definición y agregarla acá. El endpoint
 * y el frontend no cambian.
 */
const REGISTRY: readonly UniverseDefinition[] = [tasaFija];

export const universes = new Map(REGISTRY.map((u) => [u.slug, u]));

export function getUniverse(slug: string): UniverseDefinition | undefined {
  return universes.get(slug);
}

export function listUniverses() {
  return REGISTRY.map(({ slug, label, description }) => ({ slug, label, description }));
}

export type { UniverseDefinition } from './types';
