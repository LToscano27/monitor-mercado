import type { IsoDate } from './conventions';

/** Cotización normalizada, independiente de la fuente. */
export interface Quote {
  symbol: string;
  /** Último precio operado. null si no operó. */
  last: number | null;
  /** Cierre de la rueda anterior. */
  previousClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  vwap: number | null;
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  /** Volumen nominal negociado. */
  volumeNominal: number | null;
  /** Monto efectivo negociado, en la moneda de denominación. */
  volumeAmount: number | null;
  /** Cantidad de órdenes / operaciones del día. Proxy de liquidez. */
  orderCount: number | null;
  /** Hora del último trade, 'HH:MM:SS' hora local de la plaza. */
  lastTradeTime: string | null;
  currency: string;
  /** Plazo de la rueda de la que salió esta cotización. */
  settlement: 'T+1' | 'contado';
  /** Vencimiento informado por la fuente, si lo informa. */
  maturityDate: IsoDate | null;
  /** Rueda a la que corresponde el precio. Null si es el panel en vivo de hoy. */
  priceDate?: IsoDate | null;
  source: SourceId;
}

export type SourceId = 'byma';

/**
 * Cómo paga el instrumento. Decide si entra al ajuste de la curva: sólo los
 * cero cupón, que son los que miden una tasa pura a un plazo.
 *
 *  - 'cero-cupon'  un único pago al vencimiento;
 *  - 'con-cupon'   paga renta y amortiza en cuotas (TX26, DICP, PARP...);
 *  - 'dual'        paga el máximo entre dos patas (los CER/TAMAR). Su
 *                  rendimiento es el de la pata CER, un piso: el precio
 *                  incluye además el valor de la opción.
 */
export type Estructura = 'cero-cupon' | 'con-cupon' | 'dual';

/** Lo que todo instrumento del universo tiene en su referencia estática. */
export interface InstrumentReference {
  symbol: string;
  name: string;
  isin: string | null;
  issueDate: IsoDate;
  maturityDate: IsoDate;
  /** Ausente en tasa fija, donde todo es cero cupón. */
  estructura?: Estructura;
}

/** Datos de referencia estáticos de un instrumento cero cupón capitalizable. */
export interface ZeroCouponReference extends InstrumentReference {
  /** TEM de emisión, en decimal (0.021 = 2,10%). */
  issueTem: number;
  /** De dónde salió issueTem. Viaja a la respuesta para trazabilidad. */
  temSource: 'byma-ficha' | 'manual' | 'licitacion';
}

/**
 * Referencia de un título ajustable por CER.
 *
 * No lleva tasa: los cero cupón se valúan con las dos fechas y el CER, que no
 * es estático y se trae en cada request. Los que pagan cupón necesitan además
 * su cronograma, que vive en código (`tasa-cer-condiciones.ts`) porque la
 * ficha lo trae en texto libre.
 */
export interface CerReference extends InstrumentReference {
  estructura: Estructura;
}

/** Un CER puntual: la fecha a la que se tomó y el valor publicado. */
export interface CerPunto {
  fecha: IsoDate;
  valor: number;
}

/** Cómo se llegó al capital ajustado de un título CER, para verificarlo a mano. */
export interface CerDetalle {
  /** CER de diez hábiles antes de la emisión. */
  emision: CerPunto;
  /** CER de diez hábiles antes de la liquidación. */
  liquidacion: CerPunto;
  /**
   * Intereses capitalizados antes de empezar a pagar, como factor sobre el
   * VN. 1 salvo en el Discount (1,2699) y el Cuasipar (1,3886).
   */
  coeficienteCapitalizacion: number;
  /** Fracción del VN original que falta amortizar. */
  residual: number;
  /** VN 100 × residual × capitalización × CER liquidación / CER emisión. */
  capitalAjustado: number;
  /** Pagos que quedan por cobrar. */
  flujosRestantes: number;
}

export type QualityLevel = 'ok' | 'warn' | 'bad';

export interface QualityFlag {
  code: QualityFlagCode;
  message: string;
  level: QualityLevel;
}

export type QualityFlagCode =
  | 'NO_TRADES_TODAY'
  | 'STALE_PRICE'
  | 'THIN_VOLUME'
  | 'MISSING_REFERENCE'
  | 'MATURITY_MISMATCH'
  | 'MATURED';

export interface InstrumentRow {
  ticker: string;
  name: string;
  maturityDate: IsoDate;
  /**
   * Días desde la liquidación hasta el vencimiento. Es a la vez lo que se
   * muestra y el plazo con el que se calculan TEM y TEA: el comprador
   * inmoviliza plata recién desde que liquida.
   */
  daysToMaturity: number;
  /**
   * Días hábiles desde la liquidación hasta el vencimiento.
   *
   * Es el que decide si el papel entra a la curva por defecto: a un hábil o
   * menos, su tasa implícita es ruido — un centavo de precio le mueve la TEM
   * casi un punto básico por cada día que le falta.
   */
  businessDaysToMaturity: number;
  /**
   * Con qué plazo de liquidación se contaron esos días.
   *
   * Casi siempre 'T+1', el plazo de referencia del mercado. Cuando el T+1
   * caería en el vencimiento o después, el papel ya no se puede operar a 24
   * horas y pasa a negociarse en contado: ahí el plazo se cuenta desde la
   * rueda misma. Es lo que hacen las pantallas del mercado, y sin esto un
   * papel a días de vencer se queda sin tasa.
   */
  settlementBasis: 'T+1' | 'contado';
  estructura: Estructura;
  /**
   * Duration de Macaulay en días. En un cero cupón es el plazo al
   * vencimiento; en uno con cupón es menor, y es contra ella que se lo
   * compara con la curva.
   */
  durationDays: number | null;
  lastPrice: number | null;
  /**
   * De dónde salió lastPrice:
   *  - 'trade'          último operado de la rueda en curso;
   *  - 'close'          cierre de la última rueda (mercado cerrado);
   *  - 'previous-close' cierre anterior, porque hoy no operó.
   */
  priceBasis: 'trade' | 'close' | 'previous-close' | null;
  /** Rueda a la que corresponde lastPrice. */
  priceDate: IsoDate | null;
  priceChange: number | null;
  priceChangePct: number | null;
  tem: number | null;
  tea: number | null;
  /**
   * Monto que paga el instrumento al vencimiento por cada 100 de VN.
   * Null en los CER: su pago final depende de un CER que todavía no existe.
   */
  finalPayment: number | null;
  /** Sólo en los CER: de dónde sale el capital ajustado. */
  cer: CerDetalle | null;
  bid: number | null;
  ask: number | null;
  volumeAmount: number | null;
  volumeNominal: number | null;
  orderCount: number | null;
  lastTradeTime: string | null;
  /** Timestamp del dato: rueda + hora del último trade, ISO con offset. */
  dataTimestamp: string | null;
  quality: {
    level: QualityLevel;
    flags: QualityFlag[];
  };
  reference: {
    issueDate: IsoDate;
    isin: string | null;
    /** Sólo en tasa fija. */
    issueTem?: number;
    temSource?: ZeroCouponReference['temSource'];
  } | null;
}

/** Cómo se muestra un universo: lo decide su definición, no el frontend. */
export interface VistaUniverso {
  tituloCurva: string;
  /**
   * Qué va en el eje horizontal de la curva. Tasa fija es todo cero cupón y
   * usa el plazo al vencimiento. La CER mezcla bonos que pagan cupón, y a
   * esos el plazo que los compara con el resto es la duration.
   */
  ejeX: 'vencimiento' | 'duration';
  /** Si la ventana lleva el panel de inflación breakeven. */
  breakeven: boolean;
}

export interface UniverseResponse {
  universe: string;
  label: string;
  vista: VistaUniverso;
  /** Rueda a la que corresponden los precios. */
  tradeDate: IsoDate;
  /**
   * A qué rueda corresponden los precios:
   *  - 'intradiaria'  panel en vivo, rueda en curso;
   *  - 'cierre'       cierre de la última rueda.
   *
   * No hay un tercer estado. Con BYMA como única fuente, o sabemos de cuándo
   * es el precio o no hay respuesta: nunca se publica un precio sin fecha.
   */
  session: 'intradiaria' | 'cierre';
  /** Fecha de liquidación T+1 usada para contar días. */
  settlementDate: IsoDate;
  /** Momento en que nuestro backend trajo el dato. */
  fetchedAt: string;
  source: SourceId;
  conventions: import('./conventions').ConventionsMeta;
  instruments: InstrumentRow[];
  /** Problemas a nivel universo, no a nivel instrumento. */
  warnings: string[];
}
