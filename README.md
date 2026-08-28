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

**No hay fuente de respaldo, y es deliberado.** Hubo una (data912) y se dio de
baja: servía el último precio conocido sin decir de cuándo era. Un precio sin
fecha no se puede descontar — el rendimiento sale de comparar el precio contra
el pago final a lo largo de los días que faltan, así que un precio de ayer
sobre el horizonte de hoy da tasas infladas, y más cuanto más corto el plazo.
Llegó a invertir la curva entera. Si BYMA no responde, el endpoint devuelve un
error explícito: preferimos eso a una curva inventada.

**Descartada: Primary (Matba ROFEX).** Requiere credenciales y su entorno
abierto es paper trading, con precios que no son de mercado real.

- `GET /chart/historical-series/history` — serie diaria por instrumento.
  Requiere el sufijo ` 24HS` en el símbolo.

El fetch es server-side por diseño: además del CORS, todos los cálculos viven
en el backend. El frontend consume `/api/universe/[slug]` y sólo dibuja.

### Cuidar la fuente

BYMA no publica su rate limit pero lo aplica, y lo aplica callado: ante
demasiados pedidos deja de completar el handshake TCP y descarta los paquetes
sin RST. Desde afuera se parece exactamente a una caída del servicio — DNS
resuelve, `www.byma.com.ar` responde 200, y `open.bymadata.com.ar` simplemente
no contesta. Salir de ese estado lleva rato, y cada reintento lo renueva.

Tres defensas, en capas:

1. **Cache del CDN.** El endpoint manda `s-maxage`, y el cliente **no** pide con
   `no-store`: si lo hiciera, cada refresco de cada pestaña saltearía el cache y
   dispararía la función.
2. **Cache en el proceso** (`src/lib/cache.ts`). Los paneles se retienen 15 s y
   los cierres 15 min, con deduplicación de pedidos en vuelo. En la rama de
   cierre una vuelta completa son 13 pedidos: sin esto, uno por refresco.
3. **Cortacircuitos.** Tras un fallo, esa clave queda en pausa 45 s y los
   pedidos fallan rápido sin tocar la red.

Medido: primera vuelta 24 pedidos, las dos siguientes 0.

### Mercado abierto y mercado cerrado

Fuera del horario de rueda BYMA **no deja de responder**: devuelve el panel
completo con todos los campos en cero, cierre anterior incluido. Un panel
ceroteado no significa "no operó", significa "no hay rueda abierta".

Por eso el endpoint tiene dos ramas, y `session` en la respuesta dice cuál se
usó:

| `session` | de dónde sale el precio |
|---|---|
| `intradiaria` | panel en vivo, último operado de la rueda en curso |
| `cierre` | serie histórica, cierre de la última rueda |

No hay un tercer estado: o se sabe de cuándo es el precio, o no hay respuesta.

Con el mercado cerrado, **la rueda de referencia no es hoy**: es la última con
datos. La liquidación T+1 y el conteo de días cuelgan de esa fecha, no del
calendario, así que los rendimientos son los que corresponden a ese cierre.
Cada instrumento informa además su `priceDate` y su `priceBasis`.

## Convenciones de cálculo

Viven todas en `src/lib/conventions.ts`. Ese es el único lugar donde están; si
una regla cambia, cambia ahí y en ningún otro archivo.

| convención | valor |
|---|---|
| Base de días | **actual/365** |
| Liquidación | **T+1 hábil** (con calendario de feriados bursátiles) |
| Días al vencimiento | desde la **fecha de liquidación de su rueda**, no desde hoy |
| Capitalización | meses calendario enteros + remanente / 30 |
| TEM | `(pagoFinal / precio) ^ (30 / díasAlVencimiento) − 1` |
| TEA | `(pagoFinal / precio) ^ (365 / díasAlVencimiento) − 1` |

TEM porque es como cotiza el mercado local; TEA para que la curva sea
comparable. Son consistentes por construcción: `TEA = (1 + TEM) ^ (365/30) − 1`.

### Papeles por vencer: contado en vez de 24hs

El plazo sale de la rueda en la que el papel realmente cotiza, no de una regla
de fechas. Casi todos operan a 24hs, y ahí los días se cuentan desde T+1.

Un papel a pocos días de vencer pierde esa rueda —a 24hs liquidaría en el
vencimiento o después— y queda operando **solo en contado**, que liquida el
mismo día. BYMA lo refleja en `settlementType`: esas especies aparecen con
`1` y sin fila `2`. Si se filtra por 24hs a secas desaparecen de la curva justo
cuando siguen operando con volumen.

Por eso `fetchQuotes` prefiere 24hs y cae a contado solo cuando no hay otra, y
cada instrumento informa su `settlementBasis`. En la tabla esos papeles salen
marcados con `CI`.

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
    src/lib/sources/byma.ts       única fuente de datos
    src/lib/cache.ts              cache en proceso y cortacircuitos
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

Eje X: días al vencimiento. Eje Y: TEA o TEM, a elección.

Los instrumentos se grafican como puntos dispersos. El trazo es un **ajuste
logarítmico** por mínimos cuadrados de la forma `TEA = a + b · ln(días)`. No es
una unión de puntos: unir los puntos con segmentos rectos no describe ninguna
curva de rendimientos. El R² y el n van dibujados sobre el gráfico para que se
sepa cuánto confiar en el trazo.

**Qué entra a la curva** se elige: cada bono se saca o se vuelve a poner desde
la lista de fichas o haciendo clic en su punto. Al sacarlo desaparece del
gráfico — punto y etiqueta — y la regresión se recalcula con los que queden.
Los instrumentos con marcas de calidad quedan fuera del ajuste siempre.

**Los papeles a un día hábil o menos del vencimiento salen por defecto.** A ese
plazo la tasa implícita deja de ser información: la TEM eleva el cociente a la
potencia 30/días, así que a tres días calendario cualquier ruido de precio se
multiplica por diez. Medido sobre S31G6: un centavo de precio mueve la TEM 0,8
puntos básicos, y cuatro centavos —0,03% del precio— explican 34 puntos básicos
de diferencia contra otra fuente. Siguen en la tabla con su precio y su
variación, que son datos reales; lo que no hacen es torcer el ajuste. Es un
default, no una regla: con un clic en su ficha vuelven.

## Diseño

Tokens en `src/app/globals.css`. La regla rectora: **el único color saturado de
la pantalla es la dirección del cambio de precio**. La curva, los ejes y el
texto van en tinta.

`--sube` y `--baja` son verde y rojo, la convención del mercado, y son colores
de estado: fijos en los dos modos. Pasan banda de luminosidad, croma, piso de
visión normal y contraste contra las dos superficies reales. **No pasan la
separación bajo daltonismo**: verde y rojo miden ΔE 4,1 en deuteranopía, un
problema inherente al par. La mitigación es que acá el color es redundante —
todo número lleva su signo `+` o `−` explícito, así que el sentido nunca
depende del hue. No sacar los signos.

Los instrumentos marcados se dibujan con punto hueco y anillo punteado — la
forma los distingue, no el color — y la razón aparece al pasar por encima.

## Altas y bajas automáticas

El universo vigente se arma en cada request; la referencia versionada es la
base y el lugar de los overrides manuales, no una lista cerrada.

**Bajas.** Una especie cuyo vencimiento ya pasó sale sola. El día que S31G6
liquide deja de existir para la curva sin que nadie toque nada.

**Altas.** Un ticker que aparece en el panel de BYMA, tiene forma de especie
del universo y vencimiento futuro se resuelve contra su ficha técnica y entra
con todas las funciones. La ficha se cachea 24 h, así que cada especie se
resuelve una sola vez por instancia, y hay un tope de 4 fichas por request
para no castigar a la fuente si aparecen varias juntas.

La clasificación vive en `src/lib/universes/tasa-fija-clasificador.ts` y la
usan tanto el script offline como el descubrimiento en caliente, para que una
emisión nueva no se clasifique distinto según quién la mire.

**Lo único que no se puede automatizar** es la TEM de emisión cuando BYMA no
la publica en la ficha — le pasa a una minoría, como `S13N6` y `S15S6`. Sin
ese dato no hay pago al vencimiento y por lo tanto no hay rendimiento. Esas
especies quedan fuera con un aviso explícito en `warnings` que dice qué
cargar y dónde: `MANUAL_ISSUE_TEM` en `tasa-fija-spec.ts`.

## Mantenimiento

`npm run refresh:reference` regenera el archivo versionado. Ya no hace falta
para que aparezca una especie nueva —eso pasa solo— pero sirve para
consolidar la referencia y revisar la clasificación completa de una.

El calendario de feriados bursátiles de `conventions.ts` hay que mantenerlo al
día: un feriado faltante corre la fecha de liquidación un día y mueve
visiblemente la tasa de los papeles cortos.
