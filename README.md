# Monitor Mercado — renta fija en pesos

Curva, precios y variación diaria del universo de **tasa fija** del Tesoro
argentino: LECAPs y BONCAPs, instrumentos cero cupón en pesos que capitalizan y
pagan todo al vencimiento.

**En producción: <https://monitor-mercado-4net.vercel.app>**

La arquitectura está preparada para sumar después las curvas CER y dólar
linked: el universo es un parámetro, no algo hardcodeado.

## Correr en local

```bash
npm install
npm run dev
```

Abre en <http://localhost:3000>. La raíz redirige al primer universo del
registro.

| comando | qué hace |
|---|---|
| `npm run dev` | servidor de desarrollo |
| `npm run build` | build de producción |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run validate` | corre el pipeline sin levantar Next e imprime una tabla legible |
| `npm run validate -- --json` | JSON crudo del endpoint |
| `npm run refresh:reference` | regenera la referencia estática desde la ficha técnica de BYMA |

**No hacen falta variables de entorno.** Las dos fuentes de datos son públicas
y sin autenticación.

## Rutas

    /                              redirige al primer universo
    /tasa-fija                     tablero
    GET /api/universe              catálogo de universos
    GET /api/universe/tasa-fija    universo completo, ya calculado

## Fuente de datos

**Principal: BYMA** (`open.bymadata.com.ar`), sin API key.

- `POST /lebacs` — LECAPs (serie S). No está documentado públicamente, pero es
  el único panel que las trae.
- `POST /public-bonds` — BONCAPs (serie T). No incluye las LECAPs, así que
  hacen falta los dos paneles.
- `POST /bnown/fichatecnica/especies/general` — ficha técnica. Se usa offline,
  no en el path del request.

Se eligió por ser la única fuente que trae **fecha de vencimiento**, cierre
anterior y hora del último trade, además de la ficha técnica.

**Respaldo: data912** (`data912.com`). Verificado contra BYMA: sus 217 símbolos
son un subconjunto exacto de los T+1 de BYMA con valores idénticos. No informa
vencimiento ni hora del trade, así que esos datos salen de la referencia local.

**Descartada: Primary (Matba ROFEX).** Requiere credenciales y su entorno
abierto es paper trading, con precios que no son de mercado real.

El fetch es server-side por diseño: además del CORS, todos los cálculos viven
en el backend. El frontend consume `/api/universe/[slug]` y sólo dibuja.

## Convenciones de cálculo

Viven todas en `src/lib/conventions.ts`. Ese es el único lugar donde están; si
una regla cambia, cambia ahí y en ningún otro archivo.

| convención | valor |
|---|---|
| Base de días | **actual/365** |
| Liquidación | **T+1 hábil** (con calendario de feriados bursátiles) |
| Días al vencimiento | desde la **fecha de liquidación**, no desde hoy |
| Capitalización | meses calendario enteros + remanente / 30 |
| TEM | `(pagoFinal / precio) ^ (30 / díasAlVencimiento) − 1` |
| TEA | `(pagoFinal / precio) ^ (365 / díasAlVencimiento) − 1` |

TEM porque es como cotiza el mercado local; TEA para que la curva sea
comparable. Son consistentes por construcción: `TEA = (1 + TEM) ^ (365/30) − 1`.

### El pago al vencimiento

Las LECAPs y BONCAPs **no pagan 100 al vencimiento**: pagan el valor nominal
capitalizado a la TEM de emisión desde la fecha de emisión. Sin ese monto no
hay rendimiento posible, y ninguna fuente de precios lo trae. Sale de la ficha
técnica de BYMA y queda versionado en `src/lib/reference/tasa-fija.json`.

### Por qué el exponente no es días/30

La capitalización cuenta **meses calendario enteros más el remanente sobre 30**,
no los días totales divididos 30. La diferencia es chica en el tramo largo y
distorsiona el corto: para S31G6 a 3 días de vencer, días/30 daba una TEM de
4,52 % contra 1,97 % con la convención correcta — un outlier inventado por la
fórmula.

## Calidad del dato

Ningún instrumento se descarta en silencio. Un papel con problemas se devuelve
igual, marcado, y el frontend decide si lo atenúa u oculta.

| flag | criterio |
|---|---|
| `NO_TRADES_TODAY` | no operó; se usa el cierre anterior y `priceBasis` lo declara |
| `THIN_VOLUME` | menos de 10 operaciones en la rueda |
| `MATURED` | vence antes o el mismo día de la liquidación |
| `MATURITY_MISMATCH` | el vencimiento de la fuente no coincide con el de la referencia |
| `STALE_PRICE` | está en la referencia pero la fuente no lo devolvió |
| `MISSING_REFERENCE` | hay precio pero no se pudo calcular el rendimiento |

Los instrumentos marcados quedan **excluidos de la regresión** de la curva: un
papel sin operar no puede deformar la curva de todos los demás.

## Arquitectura

    src/lib/conventions.ts        convenciones de cálculo — ÚNICO lugar donde viven
    src/lib/pricing/              motores de valuación (hoy: cero cupón)
    src/lib/quality.ts            reglas de calidad del dato
    src/lib/sources/byma.ts       fuente principal
    src/lib/sources/data912.ts    fuente de respaldo
    src/lib/universes/            registro de universos
    src/lib/reference/            datos estáticos generados, versionados
    src/lib/build.ts              orquestador: fuente + referencia + cálculo + calidad
    src/lib/format.ts             formateo de la interfaz (ningún cálculo)
    src/lib/escala.ts             geometría de los gráficos
    src/lib/ajuste.ts             regresión logarítmica de la curva
    src/app/api/universe/[slug]/  proxy serverless
    src/app/[universe]/           tablero, con el universo como parámetro de ruta
    src/components/               PanelCurva · TablaPrecios · Tablero

Para sumar la curva CER: generar su referencia, escribir su
`UniverseDefinition` y registrarla en `src/lib/universes/index.ts`. Ni el
endpoint ni el frontend cambian.

## La curva

Los instrumentos se grafican como puntos dispersos. El trazo es un **ajuste
logarítmico** por mínimos cuadrados de la forma `TEA = a + b · ln(días)`,
calculado sólo sobre los puntos sin marcas de calidad. No es una unión de
puntos: unir los puntos con segmentos rectos no describe ninguna curva de
rendimientos. El R² y el n van dibujados sobre el gráfico para que se sepa
cuánto confiar en el trazo.

## Diseño

Tokens en `src/app/globals.css`. La regla rectora: **el único color saturado de
la pantalla es la dirección del cambio de precio**. La curva, los ejes y el
texto van en tinta. Los valores de `--sube` y `--baja` están validados contra
las dos superficies reales (banda de luminosidad, croma, separación bajo
daltonismo, piso de visión normal y contraste). No cambiarlos sin volver a
validar.

Los instrumentos marcados se dibujan con punto hueco y anillo punteado — la
forma los distingue, no el color — y la razón aparece al pasar por encima.

## Mantenimiento

Cuando el Tesoro emite una especie nueva, el endpoint avisa en `warnings` que
hay tickers sin clasificar. Ahí hay que correr:

```bash
npm run refresh:reference
```

Dos instrumentos (`S13N6`, `S15S6`) tienen la TEM de emisión cargada a mano
porque la ficha técnica de BYMA no la informa; salen marcados con
`temSource: "manual"` en la respuesta.

El calendario de feriados bursátiles de `conventions.ts` hay que mantenerlo al
día: un feriado faltante corre la fecha de liquidación un día y mueve
visiblemente la tasa de los papeles cortos.
