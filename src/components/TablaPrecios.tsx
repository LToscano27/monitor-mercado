'use client';

import { useMemo, useState } from 'react';
import type { InstrumentRow } from '@/lib/types';
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
import estilos from './TablaPrecios.module.css';

type Clave =
  | 'ticker' | 'maturityDate' | 'daysToMaturity' | 'lastPrice' | 'priceChange'
  | 'priceChangePct' | 'tem' | 'tea' | 'finalPayment' | 'volumeAmount' | 'orderCount'
  | 'calendarDaysToMaturity';

interface Columna {
  clave: Clave;
  titulo: string;
  ayuda?: string;
  numerica: boolean;
}

const COLUMNAS: Columna[] = [
  { clave: 'ticker', titulo: 'Ticker', numerica: false },
  { clave: 'maturityDate', titulo: 'Vence', numerica: false },
  {
    clave: 'calendarDaysToMaturity',
    titulo: 'Días al vto.',
    ayuda: 'Días corridos hasta el vencimiento. El rendimiento se calcula desde la liquidación T+1, que puede caer uno o más días después.',
    numerica: true,
  },
  { clave: 'lastPrice', titulo: 'Precio', numerica: true },
  { clave: 'priceChange', titulo: 'Var.', numerica: true },
  { clave: 'priceChangePct', titulo: 'Var. %', numerica: true },
  { clave: 'tem', titulo: 'TEM', ayuda: 'Tasa efectiva mensual', numerica: true },
  { clave: 'tea', titulo: 'TEA', ayuda: 'Tasa efectiva anual, actual/365', numerica: true },
  { clave: 'finalPayment', titulo: 'Pago final', ayuda: 'Monto que paga el instrumento al vencimiento por cada 100 de valor nominal', numerica: true },
  { clave: 'volumeAmount', titulo: 'Volumen', numerica: true },
  { clave: 'orderCount', titulo: 'Ops.', numerica: true },
];

export function TablaPrecios({ instrumentos }: { instrumentos: InstrumentRow[] }) {
  const [orden, setOrden] = useState<{ clave: Clave; desc: boolean }>({
    clave: 'calendarDaysToMaturity',
    desc: false,
  });

  const ordenados = useMemo(() => {
    const copia = [...instrumentos];
    copia.sort((a, b) => {
      const va = a[orden.clave];
      const vb = b[orden.clave];
      if (va === null) return 1;
      if (vb === null) return -1;
      const cmp = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), 'es-AR');
      return orden.desc ? -cmp : cmp;
    });
    return copia;
  }, [instrumentos, orden]);

  const alternar = (clave: Clave) =>
    setOrden((prev) =>
      prev.clave === clave ? { clave, desc: !prev.desc } : { clave, desc: true },
    );

  return (
    <div className={estilos.marco}>
      <table className={estilos.tabla}>
        <caption className={estilos.leyenda}>
          Precios y rendimientos del universo completo. Ordenable por cualquier columna.
        </caption>
        <thead>
          <tr>
            {COLUMNAS.map((c) => {
              const activa = orden.clave === c.clave;
              return (
                <th
                  key={c.clave}
                  scope="col"
                  className={c.numerica ? estilos.numerica : undefined}
                  aria-sort={activa ? (orden.desc ? 'descending' : 'ascending') : 'none'}
                >
                  <button
                    type="button"
                    onClick={() => alternar(c.clave)}
                    className={`${estilos.botonOrden} ${activa ? estilos.ordenActivo : ''}`}
                    title={c.ayuda}
                  >
                    {c.titulo}
                    <span aria-hidden className={estilos.flecha}>
                      {activa ? (orden.desc ? '↓' : '↑') : ''}
                    </span>
                  </button>
                </th>
              );
            })}
            <th scope="col" className={estilos.estadoCol}>Estado</th>
          </tr>
        </thead>
        <tbody>
          {ordenados.map((i) => {
            const marcado = i.quality.level !== 'ok';
            const razones = i.quality.flags.map((f) => f.message).join(' · ');
            return (
              <tr key={i.ticker} data-marcado={marcado || undefined}>
                <th scope="row" className={`mono ${estilos.ticker}`}>{i.ticker}</th>
                <td className={estilos.fecha}>{fechaCorta(i.maturityDate)}</td>
                <td className={`mono ${estilos.numerica}`}>
                  {entero(i.calendarDaysToMaturity)}
                </td>
                <td className={`mono ${estilos.numerica} ${estilos.precio}`}>{precio(i.lastPrice)}</td>
                <td className={`mono ${estilos.numerica}`} data-tono={tono(i.priceChange)}>
                  {numeroFirmado(i.priceChange)}
                </td>
                <td className={`mono ${estilos.numerica}`} data-tono={tono(i.priceChangePct)}>
                  {pctFirmado(i.priceChangePct)}
                </td>
                <td className={`mono ${estilos.numerica}`}>{pct(i.tem, 3)}</td>
                <td className={`mono ${estilos.numerica} ${estilos.precio}`}>{pct(i.tea)}</td>
                <td className={`mono ${estilos.numerica}`}>{precio(i.finalPayment)}</td>
                <td
                  className={`mono ${estilos.numerica}`}
                  title={
                    i.volumeAmount !== null
                      ? 'Monto efectivo negociado'
                      : 'Volumen nominal negociado en la rueda de cierre'
                  }
                >
                  {monto(i.volumeAmount ?? i.volumeNominal)}
                </td>
                <td className={`mono ${estilos.numerica}`}>{entero(i.orderCount)}</td>
                <td className={estilos.estadoCol}>
                  {marcado ? (
                    <span className={estilos.marca} data-nivel={i.quality.level} title={razones}>
                      <span aria-hidden className={estilos.marcaPunto} />
                      {i.quality.level === 'bad' ? 'Revisar' : 'Atención'}
                    </span>
                  ) : (
                    <span className={estilos.sinMarca}>{guion}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function tono(v: number | null): 'sube' | 'baja' | undefined {
  if (v === null || v === 0) return undefined;
  return v > 0 ? 'sube' : 'baja';
}
