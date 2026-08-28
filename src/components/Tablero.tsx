'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UniverseResponse } from '@/lib/types';
import { PanelCurva, type Metrica } from './PanelCurva';
import { SelectorInstrumentos } from './SelectorInstrumentos';
import { TablaPrecios } from './TablaPrecios';
import { SelectorTema } from './SelectorTema';
import { fechaCorta, guion } from '@/lib/format';
import estilos from './Tablero.module.css';

const REFRESCO_MS = 60_000;

/**
 * A un día hábil o menos del vencimiento, la tasa implícita deja de ser
 * información: el plazo es tan corto que un centavo de precio la mueve casi un
 * punto básico por cada día que falta. Esos papeles entran a la pantalla igual
 * —en la tabla, con su precio y su variación— pero salen de la curva por
 * defecto, para no torcer el ajuste con un punto que es ruido.
 *
 * Es un default, no una regla: la ficha del papel sigue ahí y con un clic
 * vuelve.
 */
const HABILES_MINIMOS_EN_CURVA = 2;

const ETIQUETA_SESION: Record<UniverseResponse['session'], string> = {
  intradiaria: 'en curso',
  cierre: 'cerrada',
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
  // Sólo guardamos lo que el lector decidió a mano. El resto lo define el
  // default, así que un papel que se acerca al vencimiento sale solo de la
  // curva sin pisar ninguna elección previa.
  const [decisiones, setDecisiones] = useState<Record<string, 'dentro' | 'fuera'>>({});

  const excluidos = useMemo(() => {
    const fuera = new Set<string>();
    for (const i of datos?.instruments ?? []) {
      const decision = decisiones[i.ticker];
      const porDefecto = i.businessDaysToMaturity < HABILES_MINIMOS_EN_CURVA;
      if (decision ? decision === 'fuera' : porDefecto) fuera.add(i.ticker);
    }
    return fuera;
  }, [datos, decisiones]);

  const alternarInstrumento = useCallback(
    (ticker: string) => {
      setDecisiones((prev) => ({
        ...prev,
        [ticker]: excluidos.has(ticker) ? 'dentro' : 'fuera',
      }));
    },
    [excluidos],
  );

  const traer = useCallback(async () => {
    setCargando(true);
    try {
      // Sin 'no-store': así el CDN puede servir la respuesta cacheada y la
      // función —y con ella la fuente— sólo se toca cuando el cache vence.
      const res = await fetch(`/api/universe/${slug}`);
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
              <Dato etiqueta="Fuente" valor={datos.source} />
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

            <p className={estilos.nota}>Cotizaciones a 24 horas</p>
          </div>

          <div className={estilos.contenido} data-cargando={cargando || undefined}>
            <section className={estilos.panel} aria-labelledby="t-curva">
              <div className={estilos.panelCabecera}>
                <h2 id="t-curva" className={estilos.panelTitulo}>
                  Curva de tasa fija
                </h2>
              </div>
              <SelectorInstrumentos
                instrumentos={datos.instruments}
                excluidos={excluidos}
                metrica={metrica}
                onToggle={alternarInstrumento}
                onTodos={() =>
                  setDecisiones(
                    Object.fromEntries(
                      datos.instruments.map((i) => [i.ticker, 'dentro' as const]),
                    ),
                  )
                }
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
