'use client';

import { useMemo, useState, type ReactNode } from 'react';
import type { InstrumentRow, VistaUniverso } from '@/lib/types';
import {
  entero,
  fechaCorta,
  monto,
  numeroFirmado,
  pct,
  pctFirmado,
  precio,
} from '@/lib/format';
import estilos from './TablaPrecios.module.css';

interface Columna {
  clave: string;
  titulo: string;
  ayuda?: string;
  numerica: boolean;
  /** Por qué se ordena. */
  valor: (i: InstrumentRow) => number | string | null;
  celda: (i: InstrumentRow) => ReactNode;
  /** Clases extra de la celda, además de mono/numérica. */
  clase?: string;
  tono?: (i: InstrumentRow) => 'sube' | 'baja' | undefined;
  titleCelda?: (i: InstrumentRow) => string | undefined;
}

const TICKER: Columna = {
  clave: 'ticker',
  titulo: 'Ticker',
  numerica: false,
  valor: (i) => i.ticker,
  celda: (i) => i.ticker,
};

const VENCE: Columna = {
  clave: 'maturityDate',
  titulo: 'Vence',
  numerica: false,
  valor: (i) => i.maturityDate,
  celda: (i) => fechaCorta(i.maturityDate),
};

const DIAS: Columna = {
  clave: 'daysToMaturity',
  titulo: 'Días al vto.',
  ayuda:
    'Días desde la liquidación hasta el vencimiento. Normalmente T+1; los papeles que ya no se pueden operar a 24 horas se cuentan en contado.',
  numerica: true,
  valor: (i) => i.daysToMaturity,
  celda: (i) => entero(i.daysToMaturity),
};

const DURATION: Columna = {
  clave: 'durationDays',
  titulo: 'Duration',
  ayuda:
    'Duration de Macaulay en días, a la TIR real. En un cero cupón es el plazo al vencimiento; en uno que paga cupón, menos. Es el eje de la curva.',
  numerica: true,
  valor: (i) => i.durationDays,
  celda: (i) => entero(i.durationDays === null ? null : Math.round(i.durationDays)),
};

const PRECIO: Columna = {
  clave: 'lastPrice',
  titulo: 'Precio',
  numerica: true,
  valor: (i) => i.lastPrice,
  celda: (i) => precio(i.lastPrice),
  clase: estilos.precio,
};

const VARIACION: Columna = {
  clave: 'priceChange',
  titulo: 'Var.',
  numerica: true,
  valor: (i) => i.priceChange,
  celda: (i) => numeroFirmado(i.priceChange),
  tono: (i) => tono(i.priceChange),
};

const VARIACION_PCT: Columna = {
  clave: 'priceChangePct',
  titulo: 'Var. %',
  numerica: true,
  valor: (i) => i.priceChangePct,
  celda: (i) => pctFirmado(i.priceChangePct),
  tono: (i) => tono(i.priceChangePct),
};

const tem = (ayuda: string): Columna => ({
  clave: 'tem',
  titulo: 'TEM',
  ayuda,
  numerica: true,
  valor: (i) => i.tem,
  celda: (i) => pct(i.tem),
});

const tir = (ayuda: string): Columna => ({
  clave: 'tea',
  titulo: 'TIR',
  ayuda,
  numerica: true,
  valor: (i) => i.tea,
  celda: (i) => pct(i.tea),
  clase: estilos.precio,
});

const PAGO_FINAL: Columna = {
  clave: 'finalPayment',
  titulo: 'Pago final',
  ayuda: 'Monto que paga el instrumento al vencimiento por cada 100 de valor nominal',
  numerica: true,
  valor: (i) => i.finalPayment,
  celda: (i) => precio(i.finalPayment),
};

const CAPITAL_AJUSTADO: Columna = {
  clave: 'capitalAjustado',
  titulo: 'Capital ajustado',
  ayuda:
    'Por cada 100 de valor nominal original: lo que falta amortizar, con la capitalización de intereses si la hubo, ajustado por el CER de diez hábiles antes de la liquidación',
  numerica: true,
  valor: (i) => i.cer?.capitalAjustado ?? null,
  celda: (i) => precio(i.cer?.capitalAjustado ?? null),
};

const VOLUMEN: Columna = {
  clave: 'volumeAmount',
  titulo: 'Volumen',
  numerica: true,
  valor: (i) => i.volumeAmount ?? i.volumeNominal,
  celda: (i) => monto(i.volumeAmount ?? i.volumeNominal),
  titleCelda: (i) =>
    i.volumeAmount !== null
      ? 'Monto efectivo negociado'
      : 'Volumen nominal negociado en la rueda de cierre',
};

/** Las columnas de cada curva. Las de CER cambian el pago final, que no se conoce, por el capital ajustado. */
function columnas(ejeX: VistaUniverso['ejeX']): Columna[] {
  if (ejeX === 'duration') {
    return [
      TICKER, VENCE, DIAS, DURATION, PRECIO, VARIACION, VARIACION_PCT,
      tem('Tasa efectiva mensual real'),
      tir('TIR real, efectiva anual, actual/365'),
      CAPITAL_AJUSTADO, VOLUMEN,
    ];
  }
  return [
    TICKER, VENCE, DIAS, PRECIO, VARIACION, VARIACION_PCT,
    tem('Tasa efectiva mensual'),
    tir('TIR, efectiva anual, actual/365'),
    PAGO_FINAL, VOLUMEN,
  ];
}

export function TablaPrecios({
  instrumentos,
  ejeX,
}: {
  instrumentos: InstrumentRow[];
  ejeX: VistaUniverso['ejeX'];
}) {
  const cols = useMemo(() => columnas(ejeX), [ejeX]);
  const [orden, setOrden] = useState<{ clave: string; desc: boolean }>({
    clave: 'daysToMaturity',
    desc: false,
  });

  const ordenados = useMemo(() => {
    const col = cols.find((c) => c.clave === orden.clave) ?? cols[0];
    const copia = [...instrumentos];
    copia.sort((a, b) => {
      const va = col.valor(a);
      const vb = col.valor(b);
      if (va === null) return 1;
      if (vb === null) return -1;
      const cmp = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), 'es-AR');
      return orden.desc ? -cmp : cmp;
    });
    return copia;
  }, [instrumentos, orden, cols]);

  const alternar = (clave: string) =>
    setOrden((prev) =>
      prev.clave === clave ? { clave, desc: !prev.desc } : { clave, desc: true },
    );

  return (
    <div className={estilos.marco}>
      <table className={estilos.tabla}>
        <thead>
          <tr>
            {cols.map((c) => {
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
          </tr>
        </thead>
        <tbody>
          {ordenados.map((i) => {
            const marcado = i.quality.level !== 'ok';
            const razones = i.quality.flags.map((f) => f.message).join(' · ');
            return (
              // La fila marcada sigue atenuada y el motivo vive en su title,
              // aunque ya no haya una columna que lo anuncie.
              <tr
                key={i.ticker}
                data-marcado={marcado || undefined}
                title={marcado ? razones : undefined}
              >
                {cols.map((c) =>
                  c.clave === 'ticker' ? (
                    <th key={c.clave} scope="row" className={`mono ${estilos.ticker}`}>
                      {c.celda(i)}
                    </th>
                  ) : (
                    <td
                      key={c.clave}
                      className={
                        c.numerica
                          ? `mono ${estilos.numerica} ${c.clase ?? ''}`
                          : c.clave === 'maturityDate'
                            ? estilos.fecha
                            : c.clase
                      }
                      data-tono={c.tono?.(i)}
                      title={c.titleCelda?.(i)}
                    >
                      {c.celda(i)}
                    </td>
                  ),
                )}
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
