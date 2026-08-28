'use client';

import { useCallback, useMemo, useState } from 'react';
import type { InstrumentRow } from '@/lib/types';
import { escalaLineal, marcasLimpias } from '@/lib/escala';
import { regresionLogaritmica } from '@/lib/ajuste';
import {
  entero,
  fechaCorta,
  guion,
  monto,
  numeroFirmado,
  pct,
  pctFirmado,
  precio,
} from '@/lib/format';
import estilos from './PanelCurva.module.css';

export type Metrica = 'tea' | 'tem';

interface Props {
  instrumentos: InstrumentRow[];
  metrica: Metrica;
  ocultarMarcados: boolean;
  /** Tickers sacados a mano del ajuste. */
  excluidos: ReadonlySet<string>;
  onToggle: (ticker: string) => void;
}

const ALTO_CURVA = 360;
const ALTO_EJE = 46;
const PAD_SUP = 20;
const PAD_IZQ = 66;
const PAD_DER = 24;

const RADIO_PUNTO = 4.5;
const ALTO_TOTAL = PAD_SUP + ALTO_CURVA + ALTO_EJE;

export function PanelCurva({
  instrumentos,
  metrica,
  ocultarMarcados,
  excluidos,
  onToggle,
}: Props) {
  const [ancho, setAncho] = useState(960);
  const [activo, setActivo] = useState<string | null>(null);

  const medir = useCallback((nodo: HTMLDivElement | null) => {
    if (!nodo) return;
    const observer = new ResizeObserver(([entrada]) => {
      setAncho(Math.max(360, entrada.contentRect.width));
    });
    observer.observe(nodo);
    setAncho(Math.max(360, nodo.getBoundingClientRect().width));
  }, []);

  /**
   * Lo que se dibuja. Un bono sacado del ajuste sale del gráfico entero —
   * punto y etiqueta —, no queda atenuado: la escala se recalcula con los que
   * quedan y el gráfico muestra sólo la curva elegida. Vuelve con su ficha.
   */
  const visibles = useMemo(
    () =>
      instrumentos.filter(
        (i) =>
          !excluidos.has(i.ticker) && (!ocultarMarcados || i.quality.level === 'ok'),
      ),
    [instrumentos, ocultarMarcados, excluidos],
  );

  const geometria = useMemo(() => {
    const x0 = PAD_IZQ;
    const x1 = ancho - PAD_DER;

    const conDato = visibles.filter((i) => i[metrica] !== null);
    const maxDias = Math.max(30, ...visibles.map((i) => i.daysToMaturity));
    const x = escalaLineal([0, maxDias * 1.04], [x0, x1]);

    const valores = conDato.map((i) => i[metrica] as number);
    const minV = valores.length ? Math.min(...valores) : 0;
    const maxV = valores.length ? Math.max(...valores) : 1;
    const colchon = (maxV - minV) * 0.22 || 0.01;

    const curvaSup = PAD_SUP;
    const curvaInf = PAD_SUP + ALTO_CURVA;
    const y = escalaLineal([minV - colchon, maxV + colchon], [curvaInf, curvaSup]);

    return {
      x, y, x0, x1, curvaSup, curvaInf, maxDias,
      marcasY: marcasLimpias(minV - colchon, maxV + colchon, 5),
      marcasX: marcasLimpias(0, maxDias * 1.04, 6).filter((d) => d > 0),
    };
  }, [ancho, visibles, metrica]);

  const { x, y } = geometria;

  /**
   * Entran al ajuste los instrumentos dibujados que no tengan marcas de
   * calidad. La curva se recalcula con lo que quede.
   */
  const ajuste = useMemo(
    () =>
      regresionLogaritmica(
        visibles
          .filter((i) => i.quality.level === 'ok' && i[metrica] !== null)
          .map((i) => ({ dias: i.daysToMaturity, valor: i[metrica] as number })),
      ),
    [visibles, metrica],
  );

  const trazo = useMemo(() => {
    if (!ajuste) return null;
    const MUESTRAS = 72;
    const puntos: string[] = [];
    for (let k = 0; k <= MUESTRAS; k += 1) {
      const dias = ajuste.desde + ((ajuste.hasta - ajuste.desde) * k) / MUESTRAS;
      puntos.push(`${k === 0 ? 'M' : 'L'} ${x(dias)} ${y(ajuste.evaluar(dias))}`);
    }
    return puntos.join(' ');
  }, [ajuste, x, y]);

  const instrumentoActivo = visibles.find((i) => i.ticker === activo) ?? null;

  const alPuntero = useCallback(
    (evento: React.PointerEvent<SVGSVGElement>) => {
      const caja = evento.currentTarget.getBoundingClientRect();
      const px = ((evento.clientX - caja.left) / caja.width) * ancho;
      let cerca: InstrumentRow | null = null;
      let mejor = Infinity;
      for (const i of visibles) {
        const d = Math.abs(x(i.daysToMaturity) - px);
        if (d < mejor) {
          mejor = d;
          cerca = i;
        }
      }
      setActivo(cerca && mejor < 60 ? cerca.ticker : null);
    },
    [visibles, x, ancho],
  );

  const etiquetaMetrica = metrica === 'tea' ? 'TEA' : 'TEM';

  const conRendimiento = visibles.filter((i) => i[metrica] !== null).length;

  // Sin rendimientos no hay curva. Un gráfico en blanco no dice nada; el
  // motivo, sí.
  if (conRendimiento === 0) {
    return (
      <div className={estilos.envoltorio} ref={medir}>
        <p className={estilos.vacio}>
          No hay rendimientos para graficar con los instrumentos elegidos.
        </p>
      </div>
    );
  }

  return (
    <div className={estilos.envoltorio} ref={medir}>
      <svg
        viewBox={`0 0 ${ancho} ${ALTO_TOTAL}`}
        width="100%"
        height={ALTO_TOTAL}
        className={estilos.lienzo}
        role="img"
        aria-label={`Curva de ${etiquetaMetrica} contra días al vencimiento. Los valores exactos están en la tabla de precios.`}
        onPointerMove={alPuntero}
        onPointerLeave={() => setActivo(null)}
      >
        {/* ── grilla de rendimiento ─────────────────────────────── */}
        {geometria.marcasY.map((v) => (
          <g key={`gy-${v}`}>
            <line
              x1={geometria.x0}
              x2={geometria.x1}
              y1={y(v)}
              y2={y(v)}
              className={estilos.grilla}
            />
            <text x={geometria.x0 - 12} y={y(v)} dy="0.32em" className={estilos.marcaEje}>
              {pct(v, 1)}
            </text>
          </g>
        ))}

        <text x={geometria.x0 - 12} y={geometria.curvaSup - 6} className={estilos.tituloEje}>
          {etiquetaMetrica}
        </text>

        {instrumentoActivo && (
          <line
            x1={x(instrumentoActivo.daysToMaturity)}
            x2={x(instrumentoActivo.daysToMaturity)}
            y1={geometria.curvaSup}
            y2={geometria.curvaInf}
            className={estilos.hilo}
          />
        )}

        {/* ── curva de ajuste ───────────────────────────────────── */}
        {trazo && <path d={trazo} className={estilos.trazo} />}

        {/* ── puntos ────────────────────────────────────────────── */}
        {visibles.map((i, idx) => {
          const v = i[metrica];
          if (v === null) return null;
          const cx = x(i.daysToMaturity);
          const cy = y(v);
          const marcado = i.quality.level !== 'ok';
          const esActivo = i.ticker === activo;
          const arriba = idx % 2 === 0;

          return (
            <g
              key={i.ticker}
              tabIndex={0}
              role="button"
              aria-label={`${i.ticker}, vence ${fechaCorta(i.maturityDate)}, ${etiquetaMetrica} ${pct(v)}. Activar para sacarlo de la curva`}
              onFocus={() => setActivo(i.ticker)}
              onBlur={() => setActivo(null)}
              onClick={() => onToggle(i.ticker)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onToggle(i.ticker);
                }
              }}
              className={estilos.punto}
            >
              {/* Blanco de impacto generoso: un punto de 9 px no se acierta. */}
              <circle cx={cx} cy={cy} r={16} fill="transparent" />
              <circle
                cx={cx}
                cy={cy}
                r={RADIO_PUNTO}
                className={marcado ? estilos.puntoHueco : estilos.puntoPleno}
                strokeDasharray={marcado ? '2 2' : undefined}
              />
              {esActivo && (
                <circle cx={cx} cy={cy} r={RADIO_PUNTO + 4} className={estilos.halo} />
              )}
              <text
                x={cx}
                y={arriba ? cy - 13 : cy + 20}
                className={`${estilos.ticker} ${esActivo ? estilos.tickerActivo : ''}`}
              >
                {i.ticker}
              </text>
            </g>
          );
        })}

        {/* ── eje de días al vencimiento ────────────────────────── */}
        <line
          x1={geometria.x0}
          x2={geometria.x1}
          y1={geometria.curvaInf}
          y2={geometria.curvaInf}
          className={estilos.eje}
        />
        {geometria.marcasX.map((d) => (
          <g key={`mx-${d}`}>
            <line
              x1={x(d)}
              x2={x(d)}
              y1={geometria.curvaInf}
              y2={geometria.curvaInf + 5}
              className={estilos.eje}
            />
            <text x={x(d)} y={geometria.curvaInf + 19} className={estilos.marcaX}>
              {entero(d)}
            </text>
          </g>
        ))}
        <text x={geometria.x1} y={geometria.curvaInf + 37} className={estilos.tituloEjeX}>
          DÍAS AL VENCIMIENTO
        </text>
      </svg>

      {instrumentoActivo && (
        <Globo
          instrumento={instrumentoActivo}
          metrica={metrica}
          izquierda={x(instrumentoActivo.daysToMaturity)}
          ancho={ancho}
        />
      )}
    </div>
  );
}

function Globo({
  instrumento: i,
  metrica,
  izquierda,
  ancho,
}: {
  instrumento: InstrumentRow;
  metrica: Metrica;
  izquierda: number;
  ancho: number;
}) {
  const alDerecha = izquierda > ancho * 0.62;
  const pos = (izquierda / ancho) * 100;

  return (
    <div
      className={estilos.globo}
      style={{
        left: `${pos}%`,
        transform: alDerecha ? 'translateX(calc(-100% - 18px))' : 'translateX(18px)',
      }}
      role="status"
    >
      <div className={estilos.globoTitulo}>
        <span className="mono">{i.ticker}</span>
        <span className={estilos.globoVence}>{fechaCorta(i.maturityDate)}</span>
      </div>

      <dl className={estilos.globoLista}>
        <Fila etiqueta={metrica === 'tea' ? 'TEA' : 'TEM'} valor={pct(i[metrica])} fuerte />
        <Fila
          etiqueta={metrica === 'tea' ? 'TEM' : 'TEA'}
          valor={pct(metrica === 'tea' ? i.tem : i.tea)}
        />
        <Fila
          etiqueta="Días al vto."
          valor={`${entero(i.daysToMaturity)}${i.settlementBasis === 'contado' ? '  (contado)' : ''}`}
        />
        <Fila etiqueta="Precio" valor={precio(i.lastPrice)} />
        <Fila
          etiqueta="Variación"
          valor={`${numeroFirmado(i.priceChange)}  ${pctFirmado(i.priceChangePct)}`}
          tono={i.priceChangePct === null ? undefined : i.priceChangePct >= 0 ? 'sube' : 'baja'}
        />
        <Fila etiqueta="Pago final" valor={precio(i.finalPayment)} />
        <Fila etiqueta="Volumen" valor={monto(i.volumeAmount ?? i.volumeNominal)} />
        <Fila etiqueta="Último trade" valor={i.lastTradeTime ?? guion} />
      </dl>

      {i.quality.flags.length > 0 && (
        <ul className={estilos.globoAvisos}>
          {i.quality.flags.map((f) => (
            <li key={f.code} data-nivel={f.level}>
              {f.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Fila({
  etiqueta,
  valor,
  fuerte,
  tono,
}: {
  etiqueta: string;
  valor: string;
  fuerte?: boolean;
  tono?: 'sube' | 'baja';
}) {
  return (
    <>
      <dt>{etiqueta}</dt>
      <dd className={`mono ${fuerte ? estilos.valorFuerte : ''}`} data-tono={tono}>
        {valor}
      </dd>
    </>
  );
}
