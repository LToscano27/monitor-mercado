import { dias30360, parseIsoDate, toIsoDate, type IsoDate } from '../conventions';
import type { CerReference } from '../types';

/**
 * Condiciones de emisión de los CER que pagan cupón.
 *
 * Viven en código, como los overrides de TEM de tasa fija, porque la ficha de
 * BYMA las trae en texto libre y cada bono las escribe distinto. Un CER con
 * cupón nuevo que no esté acá entra igual al descubrimiento pero sale como
 * "sin resolver", para que alguien cargue sus condiciones.
 *
 * Todo se expresa por cada 1 de VN original y antes del ajuste por CER.
 */
interface Condiciones {
  /** Días de pago (mes 1-12, día) que se repiten todos los años. */
  pagos: readonly (readonly [number, number])[];
  /** Pagos fuera de la grilla anual (el último del Par, el 31/12/2038). */
  pagosExtra?: readonly IsoDate[];
  /** Tasa anual 30/360 vigente desde cada fecha. */
  tasas: readonly { desde: IsoDate; tasa: number }[];
  /** Primer pago que amortiza. Desde ahí, cada pago devuelve 1/cuotas. */
  primeraAmortizacion: IsoDate;
  cuotas: number;
  /**
   * Intereses capitalizados antes del primer pago de renta en efectivo,
   * como factor sobre el VN. Amortizaciones y renta se calculan sobre el
   * capital capitalizado.
   */
  capitalizacion: number;
}

/**
 * Discount en pesos: 5,83% anual, pero hasta 2013 una parte no se pagaba y
 * se sumaba al capital. 31/12/2003–2008: 2,79% en efectivo y 3,04% se
 * capitaliza; 2008–31/12/2013: 4,06% y 1,77% (este segundo tramo, textual de
 * la ficha de DIP0). Capitalizando por semestre:
 *   (1 + 3,04%/2)^10 × (1 + 1,77%/2)^10 = 1,269937
 * Verificado contra el flujo publicado por un tercero para el pago del
 * 31/12/2026: el coeficiente implícito difiere en la quinta cifra.
 */
const DISCOUNT: Condiciones = {
  pagos: [
    [6, 30],
    [12, 31],
  ],
  tasas: [{ desde: '2003-12-31', tasa: 0.0583 }],
  primeraAmortizacion: '2024-06-30',
  cuotas: 20,
  capitalizacion: (1 + 0.0304 / 2) ** 10 * (1 + 0.0177 / 2) ** 10,
};

/**
 * Par en pesos: tasa escalonada, sin capitalización. Diecinueve cuotas
 * semestrales del 30/09/2029 al 30/09/2038 y la última el 31/12/2038.
 */
const PAR: Condiciones = {
  pagos: [
    [3, 31],
    [9, 30],
  ],
  pagosExtra: ['2038-12-31'],
  tasas: [
    { desde: '2003-12-31', tasa: 0.0063 },
    { desde: '2009-03-31', tasa: 0.0118 },
    { desde: '2019-03-31', tasa: 0.0177 },
    { desde: '2029-03-31', tasa: 0.0248 },
  ],
  primeraAmortizacion: '2029-09-30',
  cuotas: 20,
  capitalizacion: 1,
};

export const CONDICIONES_CER: Record<string, Condiciones> = {
  TX26: {
    pagos: [
      [5, 9],
      [11, 9],
    ],
    tasas: [{ desde: '2020-09-04', tasa: 0.02 }],
    primeraAmortizacion: '2024-11-09',
    cuotas: 5,
    capitalizacion: 1,
  },
  TX28: {
    pagos: [
      [5, 9],
      [11, 9],
    ],
    tasas: [{ desde: '2020-09-04', tasa: 0.0225 }],
    primeraAmortizacion: '2024-05-09',
    cuotas: 10,
    capitalizacion: 1,
  },
  TX31: {
    pagos: [
      [5, 30],
      [11, 30],
    ],
    tasas: [{ desde: '2022-05-31', tasa: 0.025 }],
    primeraAmortizacion: '2027-05-30',
    cuotas: 10,
    capitalizacion: 1,
  },
  DICP: DISCOUNT,
  // DIP0 es el Discount de la reapertura del canje de 2010: mismas
  // condiciones que DICP de 2010 en adelante, otro ISIN.
  DIP0: DISCOUNT,
  PARP: PAR,
  PAP0: PAR,
  /**
   * Cuasipar: 3,31% anual capitalizado íntegro hasta el 31/12/2013 y en
   * efectivo desde ahí. (1 + 3,31%/2)^20 = 1,388593, verificado igual que
   * el Discount.
   */
  CUAP: {
    pagos: [
      [6, 30],
      [12, 31],
    ],
    tasas: [{ desde: '2003-12-31', tasa: 0.0331 }],
    primeraAmortizacion: '2036-06-30',
    cuotas: 20,
    capitalizacion: (1 + 0.0331 / 2) ** 20,
  },
};

/** Un pago futuro, por cada 1 de VN original y antes del ajuste por CER. */
export interface Flujo {
  /** Fecha contractual del pago. */
  fecha: IsoDate;
  amortizacion: number;
  interes: number;
}

export interface Cronograma {
  flujos: Flujo[];
  /** Fracción del VN original que queda por amortizar a la liquidación. */
  residual: number;
  capitalizacion: number;
}

/**
 * Los pagos que le quedan a un CER después de la liquidación.
 *
 * Los cero cupón y los duales son un único pago del capital al vencimiento.
 * Los que pagan cupón se arman con sus condiciones; si no hay, null.
 *
 * El precio cotiza con el interés corrido adentro, así que el próximo cupón
 * entra completo: es de quien compra hoy.
 */
export function cronograma(ref: CerReference, liquidacion: Date): Cronograma | null {
  const liq = toIsoDate(liquidacion);
  if (ref.estructura !== 'con-cupon') {
    return ref.maturityDate > liq
      ? { flujos: [{ fecha: ref.maturityDate, amortizacion: 1, interes: 0 }], residual: 1, capitalizacion: 1 }
      : null;
  }

  const c = CONDICIONES_CER[ref.symbol];
  if (!c) return null;

  const fechas = fechasDePago(c, ref.issueDate, ref.maturityDate);
  const amortizantes = fechas.filter((f) => f >= c.primeraAmortizacion);
  if (amortizantes.length !== c.cuotas) {
    // Las condiciones no cierran con las fechas: mejor no valuar que valuar mal.
    throw new Error(
      `${ref.symbol}: ${amortizantes.length} fechas de amortización y ${c.cuotas} cuotas`,
    );
  }

  let residual = 1;
  let anterior = ref.issueDate;
  const flujos: Flujo[] = [];
  let residualALiquidacion = 1;
  for (const fecha of fechas) {
    const tasa = tasaVigente(c, anterior);
    const interes = residual * tasa * (dias30360(parseIsoDate(anterior), parseIsoDate(fecha)) / 360);
    const amortizacion = fecha >= c.primeraAmortizacion ? 1 / c.cuotas : 0;
    if (fecha > liq) flujos.push({ fecha, amortizacion, interes });
    else residualALiquidacion = residual - amortizacion;
    residual -= amortizacion;
    anterior = fecha;
  }
  return {
    flujos,
    residual: Math.max(0, residualALiquidacion),
    capitalizacion: c.capitalizacion,
  };
}

function fechasDePago(c: Condiciones, emision: IsoDate, vencimiento: IsoDate): IsoDate[] {
  const desde = Number(emision.slice(0, 4));
  const hasta = Number(vencimiento.slice(0, 4));
  const fechas = new Set<IsoDate>(c.pagosExtra ?? []);
  for (let anio = desde; anio <= hasta; anio += 1) {
    for (const [mes, dia] of c.pagos) {
      const f = `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
      if (f > emision && f <= vencimiento) fechas.add(f);
    }
  }
  return [...fechas].sort();
}

function tasaVigente(c: Condiciones, fecha: IsoDate): number {
  let vigente = c.tasas[0].tasa;
  for (const t of c.tasas) if (t.desde <= fecha) vigente = t.tasa;
  return vigente;
}
