'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BreakevenResponse } from '@/lib/breakeven';
import { escalaLineal, marcasLimpias } from '@/lib/escala';
import { fechaCorta, pct } from '@/lib/format';
import estilos from './PanelBreakeven.module.css';

/**
 * Sale de precios de cierre y cambia una vez por día. Pedirlo cada diez
 * minutos alcanza para que, al cerrar la rueda, el cálculo nuevo aparezca
 * solo sin recargar la página.
 */
const REFRESCO_MS = 10 * 60_000;

const ALTO_BARRAS = 200;
const PAD_SUP = 26;
const PAD_IZQ = 48;
const PAD_DER = 8;
/** Mes y acumulada debajo de cada barra. */
const ALTO_PIE = 52;
const ALTO_TOTAL = PAD_SUP + ALTO_BARRAS + ALTO_PIE;

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** '2026-09' -> 'sep 26' */
function mesCorto(mes: string): string {
  const [y, m] = mes.split('-').map(Number);
  return `${MESES[m - 1]} ${String(y).slice(2)}`;
}

/** '2026-09' -> 'sep'. Para cuando no entra el año. */
function mesSolo(mes: string): string {
  return MESES[Number(mes.slice(5, 7)) - 1];
}

/**
 * Debajo de este ancho por barra no entran "sep 26" ni una cifra de cinco
 * caracteres al tamaño normal: se pasa al mes solo y a cifras más chicas.
 */
const PASO_ANGOSTO = 48;

interface Barra {
  mes: string;
  valor: number;
  publicada: boolean;
  /** Inflación acumulada desde el CER de liquidación hasta el fin del mes. */
  acumulada: number | null;
  marcada: boolean;
  detalle: string;
}

export function PanelBreakeven() {
  const [datos, setDatos] = useState<BreakevenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ancho, setAncho] = useState(960);

  const traer = useCallback(async () => {
    try {
      const res = await fetch('/api/breakeven');
      const cuerpo = await res.json();
      if (!res.ok) throw new Error(cuerpo.detail ?? `El servidor respondió ${res.status}`);
      setDatos(cuerpo as BreakevenResponse);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    traer();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') traer();
    }, REFRESCO_MS);
    return () => clearInterval(id);
  }, [traer]);

  const medir = useCallback((nodo: HTMLDivElement | null) => {
    if (!nodo) return;
    const observer = new ResizeObserver(([entrada]) => {
      setAncho(Math.max(320, entrada.contentRect.width));
    });
    observer.observe(nodo);
    setAncho(Math.max(320, nodo.getBoundingClientRect().width));
  }, []);

  /**
   * Una barra por mes INDEC. Primero los ya publicados, con el dato del
   * INDEC; después los que descuenta el mercado. El mes que la ventana del
   * CER toma sólo en parte no se dibuja: una barra de dos días de inflación
   * se leería como un mes de inflación casi nula.
   */
  const barras = useMemo<Barra[]>(() => {
    if (!datos) return [];
    const publicadas: Barra[] = datos.conocida.meses
      .filter((m) => !m.parcial && m.ipcIndec !== null)
      .map((m, k, todos) => ({
        mes: m.mes,
        valor: m.ipcIndec as number,
        publicada: true,
        acumulada: k === todos.length - 1 ? datos.conocida.acumulada : null,
        marcada: false,
        detalle: `IPC ${mesCorto(m.mes)} publicado por el INDEC: ${pct(m.ipcIndec)}. En el CER: ${pct(m.cer)}.`,
      }));
    const implicitas: Barra[] = datos.meses.map((m) => ({
      mes: m.mes,
      valor: m.inflacionMensual,
      publicada: false,
      acumulada: m.beAcumulado,
      marcada: m.marcas.length > 0,
      detalle:
        `IPC ${mesCorto(m.mes)} implícito: ${pct(m.inflacionMensual)}. ` +
        `CER del ${fechaCorta(m.ventana.desde)} al ${fechaCorta(m.ventana.hasta)}. ` +
        `Curvas a ${m.dias} días: nominal ${pct(m.nominal)}, real ${pct(m.real)}.` +
        (m.marcas.includes('negativo') ? ' Forward negativo: problema de ajuste, no expectativa.' : '') +
        (m.marcas.includes('alto') ? ' Forward de más del doble del último IPC: problema de ajuste.' : ''),
    }));
    return [...publicadas, ...implicitas];
  }, [datos]);

  const geo = useMemo(() => {
    const x0 = PAD_IZQ;
    const x1 = ancho - PAD_DER;
    const paso = barras.length ? (x1 - x0) / barras.length : 0;
    const anchoBarra = Math.min(46, paso * 0.56);
    const maximo = Math.max(0.005, ...barras.map((b) => b.valor));
    const minimo = Math.min(0, ...barras.map((b) => b.valor));
    const y = escalaLineal([minimo, maximo * 1.18], [PAD_SUP + ALTO_BARRAS, PAD_SUP]);
    return {
      x0, x1, paso, anchoBarra, y,
      base: y(0),
      marcasY: marcasLimpias(minimo, maximo * 1.18, 4),
      centro: (k: number) => x0 + paso * (k + 0.5),
    };
  }, [ancho, barras]);

  const angosto = geo.paso < PASO_ANGOSTO;
  const hayPublicadas = barras.some((b) => b.publicada);
  const primeraImplicita = barras.findIndex((b) => !b.publicada);

  return (
    <section className={estilos.panel} aria-labelledby="t-breakeven">
      <div className={estilos.cabecera}>
        <h2 id="t-breakeven" className={estilos.titulo}>
          Inflación breakeven
        </h2>
        {datos && (
          <p className={estilos.sello}>
            <span>Cierre del {fechaCorta(datos.tradeDate)}</span>
            <span aria-hidden>·</span>
            <span>Encadenado sobre curvas ajustadas</span>
          </p>
        )}
      </div>

      {error && !datos && <p className={estilos.falla}>No se pudo calcular: {error}</p>}

      {datos && barras.length > 0 && (
        <>
          <div className={estilos.leyenda} aria-hidden>
            {hayPublicadas && (
              <span className={estilos.clave}>
                <span className={`${estilos.muestra} ${estilos.muestraPublicada}`} />
                Publicada por el INDEC
              </span>
            )}
            <span className={estilos.clave}>
              <span className={`${estilos.muestra} ${estilos.muestraImplicita}`} />
              Implícita en los bonos
            </span>
          </div>

          <div className={estilos.lienzo} ref={medir}>
            <svg
              viewBox={`0 0 ${ancho} ${ALTO_TOTAL}`}
              width="100%"
              height={ALTO_TOTAL}
              role="img"
              className={angosto ? estilos.angosto : undefined}
              aria-label={`Inflación mensual por mes INDEC. ${barras
                .map((b) => `${mesCorto(b.mes)} ${pct(b.valor)}${b.publicada ? ' publicada' : ''}`)
                .join(', ')}.`}
            >
              <defs>
                <pattern
                  id="rayado-publicada"
                  width="5"
                  height="5"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <line x1="0" y1="0" x2="0" y2="5" className={estilos.rayado} />
                </pattern>
              </defs>

              {geo.marcasY.map((v) => (
                <g key={`gy-${v}`}>
                  <line x1={geo.x0} x2={geo.x1} y1={geo.y(v)} y2={geo.y(v)} className={estilos.grilla} />
                  <text x={geo.x0 - 10} y={geo.y(v)} dy="0.32em" className={estilos.marcaEje}>
                    {pct(v, 1)}
                  </text>
                </g>
              ))}

              {/* Donde termina lo publicado y empieza lo que descuenta el mercado. */}
              {hayPublicadas && primeraImplicita > 0 && (
                <line
                  x1={geo.x0 + geo.paso * primeraImplicita}
                  x2={geo.x0 + geo.paso * primeraImplicita}
                  y1={PAD_SUP - 10}
                  y2={geo.base}
                  className={estilos.corte}
                />
              )}

              {barras.map((b, k) => {
                const cx = geo.centro(k);
                const arriba = Math.min(geo.y(b.valor), geo.base);
                const alto = Math.abs(geo.y(b.valor) - geo.base);
                return (
                  <g key={b.mes}>
                    <title>{b.detalle}</title>
                    <rect
                      x={cx - geo.anchoBarra / 2}
                      y={arriba}
                      width={geo.anchoBarra}
                      height={Math.max(alto, 1)}
                      className={
                        b.publicada
                          ? estilos.barraPublicada
                          : b.marcada
                            ? estilos.barraMarcada
                            : estilos.barraImplicita
                      }
                      fill={b.publicada ? 'url(#rayado-publicada)' : undefined}
                    />
                    <text x={cx} y={arriba - 7} className={estilos.valor}>
                      {pct(b.valor)}
                    </text>
                    <text x={cx} y={geo.base + 18} className={estilos.mes}>
                      {angosto ? mesSolo(b.mes) : mesCorto(b.mes)}
                    </text>
                    {b.acumulada !== null && (
                      <text x={cx} y={geo.base + 38} className={estilos.acumulada}>
                        {pct(b.acumulada, 1)}
                      </text>
                    )}
                  </g>
                );
              })}

              <line x1={geo.x0} x2={geo.x1} y1={geo.base} y2={geo.base} className={estilos.eje} />
              <text x={geo.x0 - 10} y={geo.base + 18} className={estilos.rotulo}>
                MES
              </text>
              <text x={geo.x0 - 10} y={geo.base + 38} className={estilos.rotulo}>
                ACUM.
              </text>
            </svg>
          </div>
        </>
      )}
    </section>
  );
}
