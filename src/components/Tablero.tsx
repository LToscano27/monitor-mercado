'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UniverseResponse } from '@/lib/types';
import { PanelCurva, type Metrica } from './PanelCurva';
import { SelectorInstrumentos } from './SelectorInstrumentos';
import { TablaPrecios } from './TablaPrecios';
import { SelectorTema } from './SelectorTema';
import { fechaCorta, guion } from '@/lib/format';
import estilos from './Tablero.module.css';

const REFRESCO_MS = 30_000;

const ETIQUETA_SESION: Record<UniverseResponse['session'], string> = {
  intradiaria: 'en curso',
  cierre: 'cerrada',
  desconocida: 'sin confirmar',
};

interface Props {
  slug: string;
  universos: { slug: string; label: string }[];
}

export function Tablero({ slug, universos }: Props) {
  const [datos, setDatos] = useState<UniverseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [metrica, setMetrica] = useState<Metrica>('tea');
  const [ocultarMarcados, setOcultarMarcados] = useState(false);
  const [excluidos, setExcluidos] = useState<ReadonlySet<string>>(new Set());

  const alternarInstrumento = useCallback((ticker: string) => {
    setExcluidos((prev) => {
      const siguiente = new Set(prev);
      if (!siguiente.delete(ticker)) siguiente.add(ticker);
      return siguiente;
    });
  }, []);

  const traer = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch(`/api/universe/${slug}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`El servidor respondió ${res.status}`);
      setDatos((await res.json()) as UniverseResponse);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCargando(false);
    }
  }, [slug]);

  useEffect(() => {
    traer();
    const id = setInterval(traer, REFRESCO_MS);
    return () => clearInterval(id);
  }, [traer]);

  const marcados = useMemo(
    () => datos?.instruments.filter((i) => i.quality.level !== 'ok').length ?? 0,
    [datos],
  );

  // Timestamp del dato, no de la consulta. En rueda es la hora del último
  // trade; con el mercado cerrado, el precio es el cierre de la rueda y no
  // hay hora que mostrar.
  const ultimoDato = useMemo(() => {
    if (!datos) return null;
    if (datos.session === 'cierre') return 'cierre de rueda';
    if (datos.session === 'desconocida') return 'sin confirmar';
    const horas = datos.instruments
      .map((i) => i.lastTradeTime)
      .filter((h): h is string => Boolean(h));
    return horas.length ? horas.sort().at(-1)! : null;
  }, [datos]);

  if (error && !datos) {
    return (
      <main className={estilos.pagina}>
        <div className={estilos.falla}>
          <h1>No se pudieron traer los datos</h1>
          <p>{error}</p>
          <button type="button" onClick={traer} className={estilos.botonReintentar}>
            Reintentar
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className={estilos.pagina}>
      <header className={estilos.cabecera}>
        <div className={estilos.marca}>
          <span className={estilos.marcaTitulo}>Monitor</span>
          <nav className={estilos.universos} aria-label="Universos">
            {universos.map((u) => (
              <a
                key={u.slug}
                href={`/${u.slug}`}
                aria-current={u.slug === slug ? 'page' : undefined}
                className={estilos.universo}
              >
                {u.label}
              </a>
            ))}
          </nav>
        </div>

        <div className={estilos.sello}>
          {datos && (
            <>
              <div className={estilos.selloItem}>
                <span className={estilos.selloEtiqueta}>Rueda</span>
                <span className={estilos.selloValor}>
                  {fechaCorta(datos.tradeDate)}
                  <span className={estilos.estado} data-sesion={datos.session}>
                    {ETIQUETA_SESION[datos.session]}
                  </span>
                </span>
              </div>
              <Dato
                etiqueta="Último dato"
                valor={ultimoDato ?? guion}
                mono={datos.session !== 'cierre'}
              />
              <Dato
                etiqueta="Fuente"
                valor={datos.sourceFallbackUsed ? `${datos.source} · respaldo` : datos.source}
              />
            </>
          )}
          <SelectorTema />
        </div>
      </header>

      {datos && (
        <>
          <div className={estilos.controles}>
            <div
              className={estilos.segmentado}
              role="group"
              aria-label="Medida de rendimiento"
            >
              {(['tea', 'tem'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMetrica(m)}
                  aria-pressed={metrica === m}
                  className={estilos.segmento}
                >
                  {m.toUpperCase()}
                </button>
              ))}
            </div>

            <label className={estilos.casilla}>
              <input
                type="checkbox"
                checked={ocultarMarcados}
                onChange={(e) => setOcultarMarcados(e.target.checked)}
                disabled={marcados === 0}
              />
              Ocultar datos marcados
              <span className={estilos.contador}>
                {marcados === 0 ? 'ninguno hoy' : `${marcados} de ${datos.instruments.length}`}
              </span>
            </label>

            <p className={estilos.nota}>
              {datos.conventions.dayCountBasis} · liquidación {datos.conventions.settlement} ·
              capitalización {datos.conventions.capitalization}
            </p>
          </div>

          <div className={estilos.contenido} data-cargando={cargando || undefined}>
            <section className={estilos.panel} aria-labelledby="t-curva">
              <div className={estilos.panelCabecera}>
                <h2 id="t-curva" className={estilos.panelTitulo}>
                  Curva de tasa fija
                </h2>
                <p className={estilos.panelBajada}>
                  Cada punto es un instrumento. El trazo es un ajuste logarítmico sobre
                  los bonos elegidos: sacá cualquiera de la lista o hacé clic en su punto
                  y sale del gráfico, con la curva reajustada a los que queden.
                </p>
              </div>
              <SelectorInstrumentos
                instrumentos={datos.instruments}
                excluidos={excluidos}
                metrica={metrica}
                onToggle={alternarInstrumento}
                onTodos={() => setExcluidos(new Set())}
              />
              <PanelCurva
                instrumentos={datos.instruments}
                metrica={metrica}
                ocultarMarcados={ocultarMarcados}
                excluidos={excluidos}
                onToggle={alternarInstrumento}
              />
            </section>

            <section className={estilos.panel} aria-labelledby="t-tabla">
              <div className={estilos.panelCabecera}>
                <h2 id="t-tabla" className={estilos.panelTitulo}>
                  Precios
                </h2>
                <p className={estilos.panelBajada}>
                  El universo completo, con los rendimientos ya calculados en el servidor.
                </p>
              </div>
              <TablaPrecios instrumentos={datos.instruments} />
            </section>

            {datos.warnings.length > 0 && (
              <section className={estilos.avisos} aria-label="Avisos del universo">
                {datos.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
              </section>
            )}
          </div>
        </>
      )}

      {!datos && cargando && <p className={estilos.esperando}>Trayendo la rueda…</p>}
    </main>
  );
}

function Dato({ etiqueta, valor, mono }: { etiqueta: string; valor: string; mono?: boolean }) {
  return (
    <div className={estilos.selloItem}>
      <span className={estilos.selloEtiqueta}>{etiqueta}</span>
      <span className={mono ? `mono ${estilos.selloValor}` : estilos.selloValor}>{valor}</span>
    </div>
  );
}
