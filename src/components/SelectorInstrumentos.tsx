'use client';

import type { InstrumentRow } from '@/lib/types';
import { pct } from '@/lib/format';
import estilos from './SelectorInstrumentos.module.css';

interface Props {
  instrumentos: InstrumentRow[];
  excluidos: ReadonlySet<string>;
  metrica: 'tea' | 'tem';
  onToggle: (ticker: string) => void;
  onTodos: () => void;
}

/**
 * Qué bonos entran al ajuste. Sacar un papel no lo esconde: lo deja en el
 * gráfico como punto hueco, fuera de la regresión, para poder comparar la
 * curva con y sin él y volver a meterlo de un clic.
 */
export function SelectorInstrumentos({
  instrumentos,
  excluidos,
  metrica,
  onToggle,
  onTodos,
}: Props) {
  const dentro = instrumentos.filter(
    (i) => i.quality.level === 'ok' && !excluidos.has(i.ticker),
  ).length;

  return (
    <div className={estilos.barra}>
      <span className={estilos.titulo}>En el ajuste</span>

      <div className={estilos.fichas} role="group" aria-label="Bonos incluidos en el ajuste">
        {instrumentos.map((i) => {
          const fuera = excluidos.has(i.ticker);
          return (
            <button
              key={i.ticker}
              type="button"
              role="checkbox"
              aria-checked={!fuera}
              onClick={() => onToggle(i.ticker)}
              className={`mono ${estilos.ficha}`}
              data-fuera={fuera || undefined}
              title={`${i.ticker} · ${metrica.toUpperCase()} ${pct(i[metrica])} · ${i.daysToMaturity} días`}
            >
              {i.ticker}
            </button>
          );
        })}
      </div>

      <span className={estilos.cuenta}>
        {dentro} de {instrumentos.length}
      </span>

      {excluidos.size > 0 && (
        <button type="button" onClick={onTodos} className={estilos.restaurar}>
          Incluir todos
        </button>
      )}
    </div>
  );
}
