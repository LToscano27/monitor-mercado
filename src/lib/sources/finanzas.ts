import { memo } from '../cache';

/**
 * Resultados de licitación de la Secretaría de Finanzas.
 *
 * Existe por un agujero concreto: cuando el Tesoro emite una letra nueva,
 * BYMA publica su ficha técnica pero a veces deja el campo `interes` sin el
 * porcentaje ("Pagarán una tasa efectiva mensual capitalizable mensualmente
 * hasta el vencimiento"). Sin esa TEM no hay pago al vencimiento y por lo
 * tanto no hay rendimiento: la letra queda fuera de la curva aunque esté
 * operando con volumen.
 *
 * La tasa sí está publicada, en la tabla de resultados de la licitación que
 * la adjudicó. Este módulo la va a buscar ahí.
 *
 * Es scraping de HTML, con todo lo que eso implica: si el sitio cambia de
 * forma, deja de encontrar. Por eso el modo de falla es devolver null y que
 * el instrumento siga saliendo con el warning de siempre — nunca inventar un
 * número ni voltear el request. Y por eso también hay una verificación
 * aritmética antes de aceptar el dato (ver `coherente`): que la página traiga
 * TEM y TIREA en la misma fila permite comprobar que lo que se leyó es lo que
 * se cree que es, en vez de confiar en el parseo.
 */

const BASE = 'https://www.argentina.gob.ar';
const LISTADO = `${BASE}/economia/finanzas/noticias`;
const USER_AGENT = 'monitor-mercado/1.0 (+https://github.com/LToscano27/monitor-mercado)';

const REQUEST_TIMEOUT_MS = 6_000;

/**
 * Páginas del listado que se recorren y resultados que se abren.
 *
 * Alcanza con mirar lo reciente: esto corre cuando aparece una letra nueva, y
 * una letra nueva empieza a cotizar días después de su licitación. Buscar más
 * atrás sería pedirle al sitio decenas de páginas para encontrar algo que
 * está siempre arriba de todo.
 */
const MAX_PAGINAS = 2;
const MAX_RESULTADOS = 4;

/** Una tasa adjudicada no cambia nunca; un "no está" puede ser cuestión de horas. */
const TTL_HALLADO_MS = 24 * 60 * 60_000;
const TTL_NO_HALLADO_MS = 30 * 60_000;

/** Rango mensual plausible, el mismo criterio que se usa con la ficha de BYMA. */
const RANGO_MENSUAL = { min: 0.001, max: 0.15 };

/**
 * Tolerancia al comparar la TIREA declarada contra la que implica la TEM.
 * La página redondea a dos decimales, así que la diferencia esperada es de
 * centésimas; 0,10 pp deja margen de sobra sin dejar pasar una fila ajena.
 */
const TOLERANCIA_TIREA = 0.001;

const MESES: Record<string, number> = {
  ENERO: 1,
  FEBRERO: 2,
  MARZO: 3,
  ABRIL: 4,
  MAYO: 5,
  JUNIO: 6,
  JULIO: 7,
  AGOSTO: 8,
  SEPTIEMBRE: 9,
  OCTUBRE: 10,
  NOVIEMBRE: 11,
  DICIEMBRE: 12,
};

const TTL_HTML_MS = 10 * 60_000;

/**
 * Se cachea por URL, no por búsqueda: si en una misma licitación entran dos
 * especies nuevas, el listado y la página de resultados se piden una sola vez
 * para las dos.
 */
function traerHtml(url: string, signal?: AbortSignal): Promise<string> {
  return memo(`html:${url}`, TTL_HTML_MS, () => pedirHtml(url, signal));
}

async function pedirHtml(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Finanzas respondió ${res.status} en ${url}`);
  return res.text();
}

function sinEtiquetas(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Filas de todas las tablas del documento, ya sin marcado. */
function filas(html: string): string[][] {
  const limpio = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  const salida: string[][] = [];
  for (const tabla of limpio.match(/<table[\s\S]*?<\/table>/gi) ?? []) {
    for (const fila of tabla.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
      const celdas = [...fila.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
        sinEtiquetas(c[1]),
      );
      if (celdas.length > 0) salida.push(celdas);
    }
  }
  return salida;
}

/**
 * Fecha de vencimiento escrita en la denominación del instrumento, que es
 * como la tabla identifica a las emisiones nuevas: todavía no traen ticker.
 * "…CON VENCIMIENTO 29 DE ENERO DE 2027" da '2027-01-29'.
 */
function vencimientoDeLaDenominacion(texto: string): string | null {
  const m = /VENCIMIENTO\s+(\d{1,2})\s+DE\s+([A-ZÁÉÍÓÚÑ]+)\s+DE\s+(\d{4})/i.exec(
    texto.toUpperCase(),
  );
  if (!m) return null;
  const mes = MESES[m[2]];
  if (!mes) return null;
  return `${m[3]}-${String(mes).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** "2,25% (**)" da 0.0225. Devuelve null si la celda no es un porcentaje. */
function porcentaje(celda: string): number | null {
  const m = /(-?\d+(?:[.,]\d+)?)\s*%/.exec(celda);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return Number.isFinite(n) ? n / 100 : null;
}

/**
 * ¿La TEM leída explica la TIREA de la misma fila?
 *
 * Es el control que hace confiable a todo lo demás. Si se leyó la columna
 * equivocada, si la fila era de otro instrumento o si el sitio reordenó las
 * columnas, los dos números no van a cerrar y el dato se descarta.
 */
function coherente(tem: number, tirea: number): boolean {
  return Math.abs((1 + tem) ** 12 - 1 - tirea) <= TOLERANCIA_TIREA;
}

/**
 * Busca en una página de resultados la TEM adjudicada a la letra o bono
 * capitalizable en pesos que vence en la fecha dada.
 *
 * Sólo sirve para emisiones nuevas, y es justo lo que hace falta: en una
 * reapertura la columna de corte trae un precio, no una tasa, pero una
 * reapertura ya existe en la referencia con la TEM de su emisión original.
 */
function buscarEnResultado(html: string, vencimiento: string): number | null {
  for (const celdas of filas(html)) {
    if (celdas.length < 3) continue;
    const denominacion = celdas[0].toUpperCase();
    if (!denominacion.includes('CAPITALIZABLE EN PESOS')) continue;
    if (vencimientoDeLaDenominacion(denominacion) !== vencimiento) continue;

    // La TEM y la TIREA son celdas contiguas; en vez de fijar índices —que el
    // sitio puede correr— se prueba cada par consecutivo y se acepta el que
    // cierre aritméticamente.
    for (let i = 1; i < celdas.length - 1; i += 1) {
      const tem = porcentaje(celdas[i]);
      const tirea = porcentaje(celdas[i + 1]);
      if (tem === null || tirea === null) continue;
      if (tem < RANGO_MENSUAL.min || tem > RANGO_MENSUAL.max) continue;
      if (coherente(tem, tirea)) return tem;
    }
  }
  return null;
}

/** Novedades que son un resultado de licitación por efectivo, las más nuevas primero. */
function resultadosRecientes(html: string): string[] {
  const slugs = [...html.matchAll(/href="(\/noticias\/[^"?#]+)"/g)].map((m) => m[1]);
  return [...new Set(slugs)].filter(
    (s) =>
      s.includes('/resultado-de-la-licitacion') &&
      // Las conversiones y las segundas vueltas no adjudican emisiones nuevas.
      !s.includes('conversion') &&
      !s.includes('segunda-vuelta'),
  );
}

async function buscar(vencimiento: string, signal?: AbortSignal): Promise<number | null> {
  const candidatos: string[] = [];
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina += 1) {
    const url = pagina === 0 ? LISTADO : `${LISTADO}?page=${pagina}`;
    for (const slug of resultadosRecientes(await traerHtml(url, signal))) {
      if (!candidatos.includes(slug)) candidatos.push(slug);
    }
    if (candidatos.length >= MAX_RESULTADOS) break;
  }

  for (const slug of candidatos.slice(0, MAX_RESULTADOS)) {
    const tem = buscarEnResultado(await traerHtml(`${BASE}${slug}`, signal), vencimiento);
    if (tem !== null) return tem;
  }
  return null;
}

/**
 * TEM de emisión adjudicada en licitación para el instrumento que vence en la
 * fecha dada, o null si no se pudo establecer con certeza.
 *
 * Nunca lanza: que la fuente oficial esté caída o haya cambiado de forma no
 * puede voltear la respuesta del endpoint, sólo dejar al instrumento en la
 * lista de los que hay que resolver a mano.
 */
export async function temDeLicitacion(
  vencimiento: string,
  signal?: AbortSignal,
): Promise<number | null> {
  try {
    return await memo(
      `licitacion:${vencimiento}`,
      TTL_HALLADO_MS,
      () => buscar(vencimiento, signal),
      TTL_NO_HALLADO_MS,
    );
  } catch {
    return null;
  }
}
