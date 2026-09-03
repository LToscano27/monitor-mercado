'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UniverseResponse } from '@/lib/types';
import { PanelCurva, type Metrica } from './PanelCurva';
import { SelectorInstrumentos } from './SelectorInstrumentos';
import { TablaPrecios } from './TablaPrecios';
import { SelectorTema } from './SelectorTema';
import { fechaCorta } from '@/lib/format';
import { momentoVisible } from '@/lib/conventions';
import estilos from './Tablero.module.css';

/**
 * Cada cuánto se vuelve a pedir el universo.
 *
 * En rueda se pide seguido porque el precio se mueve; con el mercado cerrado
 * el cierre ya no cambia y sondear es puro gasto. Pedir cada 20s no castiga a
 * BYMA: el CDN cachea la respuesta y el proceso cachea los paneles, así que la
 * fuente se toca mucho menos seguido que el cliente.
 */
const REFRESCO_EN_RUEDA_MS = 20_000;
const REFRESCO_CERRADO_MS = 300_000;

const HORA_PLAZA = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Buenos_Aires',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

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
    const cada =
      datos?.session === 'cierre' ? REFRESCO_CERRADO_MS : REFRESCO_EN_RUEDA_MS;
    const id = setInterval(() => {
      // Una pestaña que nadie mira no necesita datos frescos.
      if (document.visibilityState === 'visible') traer();
    }, cada);

    // Al volver a la pestaña, refrescar en el acto en vez de esperar el turno.
    const alVolver = () => {
      if (document.visibilityState === 'visible') traer();
    };
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [traer, datos?.session]);

  /**
   * Reloj de la foto: la hora de plaza menos el retraso del feed, corriendo
   * segundo a segundo.
   *
   * Vale para todos los instrumentos, no sólo para el que operó último. El
   * último precio operado de un papel es su precio vigente hasta que haya
   * otro: si S31G6 no operó entre las 12:26 y las 12:36, su precio a las 12:36
   * era el de las 12:26. Por eso una sola hora describe la pantalla entera.
   */
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  /*
   * El reloj corre siempre, con la rueda abierta o cerrada.
   *
   * Marca el momento al que corresponde lo que se ve, y ese momento sigue
   * avanzando aunque el mercado ya no opere: a las 19:00 la foto es de las
   * 18:40 y los precios son los del cierre. Que la rueda esté cerrada ya lo
   * dice la chapita de al lado; el reloj no tiene que repetirlo ni frenarse.
   */
  const hora = useMemo(() => HORA_PLAZA.format(momentoVisible(new Date(ahora))), [ahora]);

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
              <Dato etiqueta="Hora" valor={hora} mono />
              <Dato etiqueta="Fuente" valor={datos.source.toUpperCase()} />
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
                excluidos={excluidos}
                onToggle={alternarInstrumento}
              />
            </section>

            <section className={estilos.panel} aria-label="Precios">
              <TablaPrecios instrumentos={datos.instruments} />
            </section>
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
