'use client';

import { useEffect, useMemo, useState } from 'react';
import { fechaCorta } from '@/lib/format';
import {
  fechaDisponible,
  RUTA_HISTORICO,
  type FotoCurva,
  type IndiceHistorico,
} from '@/lib/historico';
import estilos from './SelectorComparacion.module.css';

interface Props {
  slug: string;
  /** Rueda de la curva actual: no tiene sentido compararla consigo misma. */
  ruedaActual: string;
  onFoto: (foto: FotoCurva | null) => void;
}

/**
 * Elegir un día para comparar la curva de hoy con la de entonces.
 *
 * Se elige cualquier fecha del calendario y se toma la última rueda guardada
 * que no sea posterior: un domingo muestra el viernes. Sólo se ofrecen fechas
 * dentro de lo guardado. El índice y cada foto son archivos estáticos que se
 * piden recién acá, así que la página no carga nada de esto hasta que el
 * lector lo usa.
 */
export function SelectorComparacion({ slug, ruedaActual, onFoto }: Props) {
  const [fechas, setFechas] = useState<string[]>([]);
  const [pedida, setPedida] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`${RUTA_HISTORICO}/indice.json`)
      .then((r) => (r.ok ? (r.json() as Promise<IndiceHistorico>) : {}))
      .then((indice) => setFechas((indice as IndiceHistorico)[slug] ?? []))
      .catch(() => setFechas([]));
  }, [slug]);

  const usada = useMemo(() => (pedida ? fechaDisponible(fechas, pedida) : null), [fechas, pedida]);

  useEffect(() => {
    if (!usada) {
      onFoto(null);
      return;
    }
    let vigente = true;
    fetch(`${RUTA_HISTORICO}/${slug}/${usada}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<FotoCurva>;
      })
      .then((foto) => {
        if (vigente) {
          setError(false);
          onFoto(foto);
        }
      })
      .catch(() => {
        if (vigente) {
          setError(true);
          onFoto(null);
        }
      });
    return () => {
      vigente = false;
    };
  }, [slug, usada, onFoto]);

  // Sin historia guardada no hay nada que elegir.
  if (fechas.length === 0) return null;

  return (
    <div className={estilos.selector}>
      <label className={estilos.etiqueta} htmlFor={`comparar-${slug}`}>
        Comparar con
      </label>
      <input
        id={`comparar-${slug}`}
        type="date"
        className={estilos.campo}
        min={fechas[0]}
        max={fechas[fechas.length - 1]}
        value={pedida}
        onChange={(e) => setPedida(e.target.value)}
      />
      {usada && usada !== pedida && (
        <span className={estilos.usada} title="Última rueda guardada hasta la fecha elegida">
          rueda del {fechaCorta(usada)}
        </span>
      )}
      {usada === ruedaActual && <span className={estilos.usada}>es la misma rueda que la actual</span>}
      {error && <span className={estilos.usada}>no se pudo traer esa rueda</span>}
      {pedida && (
        <button type="button" className={estilos.quitar} onClick={() => setPedida('')}>
          Quitar
        </button>
      )}
    </div>
  );
}
