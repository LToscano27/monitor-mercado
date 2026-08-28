'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { InstrumentRow } from '@/lib/types';
import {
  barraDivergente,
  escalaLineal,
  marcasDeMeses,
  marcasLimpias,
} from '@/lib/escala';
import { regresionLogaritmica } from '@/lib/ajuste';
import {
  entero,
  etiquetaMes,
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
  liquidacion: string;
  ocultarMarcados: boolean;
}

const ALTO_CURVA = 300;
const ALTO_EJE = 42;
const ALTO_VARIACION = 116;
const PAD_SUP = 18;
const PAD_IZQ = 66;
const PAD_DER = 22;
const PAD_INF = 10;

const ANCHO_BARRA = 16;
const RADIO_PUNTO = 4.5;

const ALTO_TOTAL = PAD_SUP + ALTO_CURVA + ALTO_EJE + ALTO_VARIACION + PAD_INF;

export function PanelCurva({ instrumentos, metrica, liquidacion, ocultarMarcados }: Props) {
  const contenedor = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(960);
  const [activo, setActivo] = useState<string | null>(null);

  const medir = useCallback((nodo: HTMLDivElement | null) => {
    if (!nodo) return;
    contenedor.current = nodo;
    const observer = new ResizeObserver(([entrada]) => {
      setAncho(Math.max(360, entrada.contentRect.width));
    });
    observer.observe(nodo);
    setAncho(Math.max(360, nodo.getBoundingClientRect().width));
  }, []);

  const visibles = useMemo(
    () =>
      ocultarMarcados
        ? instrumentos.filter((i) => i.quality.level === 'ok')
        : instrumentos,
    [instrumentos, ocultarMarcados],
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

    const cambios = visibles
      .map((i) => i.priceChangePct)
      .filter((v): v is number => v !== null);
    const maxCambio = Math.max(0.05, ...cambios.map(Math.abs)) * 1.25;

    const varSup = curvaInf + ALTO_EJE;
    const varInf = varSup + ALTO_VARIACION;
    const yVar = escalaLineal([-maxCambio, maxCambio], [varInf, varSup]);

    return {
      x, y, yVar, x0, x1, curvaSup, curvaInf, varSup, varInf, maxDias,
      marcasY: marcasLimpias(minV - colchon, maxV + colchon, 5),
      marcasVar: [maxCambio * 0.6, 0, -maxCambio * 0.6],
      marcasMes: marcasDeMeses(liquidacion, maxDias * 1.04),
      cero: yVar(0),
    };
  }, [ancho, visibles, metrica, liquidacion]);

  const { x, y, yVar } = geometria;

  // La curva de mercado es un ajuste, no una unión de puntos. Sólo entran los
  // instrumentos sin marcas de calidad: un papel que no operó no puede
  // deformar la curva de todos los demás.
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

  return (
    <div className={estilos.envoltorio} ref={medir}>
      <svg
        viewBox={`0 0 ${ancho} ${ALTO_TOTAL}`}
        width="100%"
        height={ALTO_TOTAL}
        className={estilos.lienzo}
        role="img"
        aria-label={`Curva de ${etiquetaMetrica} y variación del día por vencimiento. Los valores exactos están en la tabla de precios.`}
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

        <text
          x={geometria.x0 - 12}
          y={geometria.curvaSup - 6}
          className={estilos.tituloEje}
        >
          {etiquetaMetrica}
        </text>

        {/* ── vertical del instrumento activo, cruzando las dos bandas ── */}
        {instrumentoActivo && (
          <line
            x1={x(instrumentoActivo.daysToMaturity)}
            x2={x(instrumentoActivo.daysToMaturity)}
            y1={geometria.curvaSup}
            y2={geometria.varInf}
            className={estilos.hilo}
          />
        )}

        {/* ── curva de ajuste ───────────────────────────────────── */}
        {trazo && <path d={trazo} className={estilos.trazo} />}
        {ajuste && (
          <text x={geometria.x1} y={geometria.curvaSup - 6} className={estilos.notaAjuste}>
            {`ajuste log · R² ${ajuste.r2.toFixed(2)} · n ${ajuste.n}`}
          </text>
        )}

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
              aria-label={`${i.ticker}, vence ${fechaCorta(i.maturityDate)}, ${etiquetaMetrica} ${pct(v)}`}
              onFocus={() => setActivo(i.ticker)}
              onBlur={() => setActivo(null)}
              className={estilos.punto}
            >
              {/* Blanco de impacto generoso: un punto de 9 px no se acierta. */}
              <circle cx={cx} cy={cy} r={16} fill="transparent" />
              <circle
                cx={cx}
                cy={cy}
                r={RADIO_PUNTO}
                className={marcado ? estilos.puntoMarcado : estilos.puntoPleno}
                strokeDasharray={marcado ? '2 2' : undefined}
              />
              {esActivo && <circle cx={cx} cy={cy} r={RADIO_PUNTO + 4} className={estilos.halo} />}
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

        {/* ── eje de vencimientos: la columna vertebral ──────────── */}
        <line
          x1={geometria.x0}
          x2={geometria.x1}
          y1={geometria.curvaInf}
          y2={geometria.curvaInf}
          className={estilos.eje}
        />
        {geometria.marcasMes.map((m) => (
          <g key={`m-${m.year}-${m.monthIndex}`}>
            <line
              x1={x(m.dias)}
              x2={x(m.dias)}
              y1={geometria.curvaInf}
              y2={geometria.curvaInf + 5}
              className={estilos.eje}
            />
            <text
              x={x(m.dias)}
              y={geometria.curvaInf + 19}
              className={estilos.marcaMes}
            >
              {etiquetaMes(m.year, m.monthIndex)}
            </text>
          </g>
        ))}
        {/* ── variación del día, colgando del mismo eje ──────────── */}
        {geometria.marcasVar.map((v) => (
          <g key={`gv-${v}`}>
            <line
              x1={geometria.x0}
              x2={geometria.x1}
              y1={yVar(v)}
              y2={yVar(v)}
              className={v === 0 ? estilos.eje : estilos.grilla}
            />
            <text x={geometria.x0 - 12} y={yVar(v)} dy="0.32em" className={estilos.marcaEje}>
              {v === 0 ? '0' : pctFirmado(v, 2)}
            </text>
          </g>
        ))}
        <text x={geometria.x0 - 12} y={geometria.varSup - 6} className={estilos.tituloEje}>
          VAR. DÍA
        </text>

        {visibles.map((i) => {
          if (i.priceChangePct === null) return null;
          const cx = x(i.daysToMaturity);
          const sube = i.priceChangePct >= 0;
          const marcado = i.quality.level !== 'ok';
          return (
            <g key={`b-${i.ticker}`} className={estilos.punto}>
              <path
                d={barraDivergente(cx, ANCHO_BARRA, geometria.cero, yVar(i.priceChangePct))}
                className={sube ? estilos.barraSube : estilos.barraBaja}
                opacity={marcado ? 0.4 : 1}
              />
              <rect
                x={cx - 20}
                y={geometria.varSup}
                width={40}
                height={geometria.varInf - geometria.varSup}
                fill="transparent"
              />
            </g>
          );
        })}
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
        <Fila etiqueta={metrica === 'tea' ? 'TEM' : 'TEA'} valor={pct(metrica === 'tea' ? i.tem : i.tea)} />
        <Fila etiqueta="Precio" valor={precio(i.lastPrice)} />
        <Fila
          etiqueta="Variación"
          valor={`${numeroFirmado(i.priceChange)}  ${pctFirmado(i.priceChangePct)}`}
          tono={i.priceChangePct === null ? undefined : i.priceChangePct >= 0 ? 'sube' : 'baja'}
        />
        <Fila etiqueta="Pago final" valor={precio(i.finalPayment)} />
        <Fila etiqueta="Días" valor={entero(i.daysToMaturity)} />
        <Fila etiqueta="Volumen" valor={monto(i.volumeAmount)} />
        <Fila etiqueta="Operaciones" valor={entero(i.orderCount)} />
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
