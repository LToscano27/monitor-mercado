# Datos: fuentes, calidad e historia

De dónde salen los precios, cómo se cuida la fuente, qué se marca como dato dudoso y cómo se guarda la historia. Volver al [README](../README.md).

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

Antes de ese bloqueo hay un freno más suave: un **503 inmediato**. Medido el
01/10/2026, una tanda de treinta series de cierre seguidas pasa entera y la
siguiente pierde siete u ocho papeles. El breakeven pide las dos curvas,
cuarenta series, y salía calculado sin tres o cuatro papeles. Por eso las
series se piden con un respiro entre tandas y, ante un fallo, se espera y se
vuelve a pedir hasta tres veces, con esperas crecientes. Bajo el mismo
castigo, el código anterior traía entre 20 y 24 de los 29 papeles CER y éste
los 29. Si aun así falta alguno, el breakeven lo avisa en `warnings` y la
respuesta se retiene un minuto en el CDN en vez de diez.

### Mercado abierto y mercado cerrado

Fuera del horario de rueda BYMA **no deja de responder**: devuelve el panel
completo con todos los campos en cero, cierre anterior incluido. Un panel
ceroteado no significa "no operó", significa "no hay rueda abierta".

Por eso el endpoint tiene dos ramas, y `session` en la respuesta dice cuál se
usó:

| `session` | de dónde sale el precio |
|---|---|
| `intradiaria` | panel, dentro del horario de rueda |
| `cierre` | panel fuera de horario, o serie histórica si BYMA ya rotó el panel |

El panel manda mientras tenga datos, esté el mercado abierto o cerrado: es la
única fuente que trae el **volumen efectivo** de la rueda. BYMA lo conserva
horas después del cierre y recién de madrugada rota a la sesión siguiente.

La etiqueta de sesión sale del horario de rueda, no de si hay datos, y se lee
con el **reloj visible** — hora de plaza menos el retraso del feed — porque
toda la pantalla vive corrida hacia atrás. A las 17:05 reales la foto es de las
16:45 y el mercado sigue operando en lo que se ve: los precios cambian hasta
las 17:20 reales, cuando el feed termina de publicar la última media hora.

| hora real | reloj en pantalla | estado |
|---|---|---|
| 10:55 | 10:35 | cerrada |
| 11:25 | 11:05 | en curso |
| 17:05 | 16:45 | en curso |
| 17:19 | 16:59 | en curso |
| 17:21 | 17:01 | cerrada |

La serie histórica sólo trae volumen nominal, así que en esa rama el monto
efectivo se reconstruye con el precio de cierre. En el panel la identidad
`nominal × VWAP / 100 = volumeAmount` es exacta al peso; la única aproximación
es usar el cierre en lugar del VWAP, medida en 0,05% contra un error del 30%
si se mostrara el nominal.

No hay un tercer estado: o se sabe de cuándo es el precio, o no hay respuesta.

Con el mercado cerrado, **la rueda de referencia no es hoy**: es la última con
datos. La liquidación T+1 y el conteo de días cuelgan de esa fecha, no del
calendario, así que los rendimientos son los que corresponden a ese cierre.
Cada instrumento informa además su `priceDate` y su `priceBasis`.

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

## Altas y bajas automáticas

El universo vigente se arma en cada request; la referencia versionada es la
base y el lugar de los overrides manuales, no una lista cerrada.

**Bajas.** Una especie cuyo vencimiento ya pasó sale sola. El día que S31G6
liquide deja de existir para la curva sin que nadie toque nada.

**Altas.** Un ticker que aparece en el panel de BYMA, tiene forma de especie
del universo y vencimiento futuro se resuelve contra su ficha técnica y entra
con todas las funciones. Hay un tope de 4 fichas por request para no castigar
a la fuente si aparecen varias juntas.

Las fichas se cachean 24 h **cuando traen datos**, y sólo 10 minutos cuando
vienen vacías. La distinción importa: una letra recién licitada puede empezar
a cotizar antes de que su ficha esté publicada, y cachear ese vacío un día
entero la dejaría fuera de la curva hasta el día siguiente aunque la
publicaran diez minutos después.

Un ticker sin ficha no genera aviso. No se puede saber ni de qué curva es, así
que no hay nada que nadie pueda hacer con esa información: sería ruido
permanente. Se reintenta solo.

La clasificación vive en `src/lib/universes/tasa-fija-clasificador.ts` y la
usan tanto el script offline como el descubrimiento en caliente, para que una
emisión nueva no se clasifique distinto según quién la mire.

**Lo único que no se puede automatizar** es la TEM de emisión cuando BYMA no
la publica en la ficha — le pasa a una minoría, como `S13N6` y `S15S6`. Sin
ese dato no hay pago al vencimiento y por lo tanto no hay rendimiento. Esas
especies quedan fuera con un aviso explícito en `warnings` que dice qué
cargar y dónde: `MANUAL_ISSUE_TEM` en `tasa-fija-spec.ts`.

## Historia de las curvas

Cada curva se puede comparar con la de otro día: se elige una fecha en la
cabecera y la curva de esa rueda se dibuja debajo de la actual, punteada y
con los puntos huecos. Si la fecha no fue hábil, se toma la última rueda
anterior. Los papeles apagados en las fichas salen también de la curva vieja,
para que las dos se armen igual.

**De dónde sale.** Una foto por rueda y por curva en `public/historico/`
(`indice.json` y un archivo por día, unos 9 KB entre las dos curvas), con los
rendimientos ya calculados: la foto de un día es lo que la pantalla mostró ese
día. Son archivos estáticos que se piden sólo al elegir una fecha; la carga
normal de la página no cambia.

**Cómo se llena.**

- `npm run historico:guardar` guarda la foto del último cierre. Lo corre
  GitHub Actions de lunes a viernes a las 18:00 (`guardar-cierre.yml`).
- `npm run historico:reconstruir -- --desde=AAAA-MM-DD --hasta=AAAA-MM-DD`
  rehace días pasados con la serie histórica de BYMA. Baja primero la serie
  completa de cada papel, despacio y con reintentos, y después arma cada día
  sin tocar la red. No guarda un día si le falta el cierre de algún papel ni
  pisa una foto guardada al cierre, salvo con `--pisar`.

**Hasta dónde se puede ir.** BYMA guarda dos años de cierres y los borra de a
un día; lo guardado acá queda. Para reconstruir días en los que vivían papeles
que ya vencieron hace falta sumar sus condiciones a la referencia, porque
BYMA borra la ficha técnica de un papel vencido.

## Mantenimiento

`npm run refresh:reference` regenera los archivos versionados. Ya no hace
falta para que aparezca una especie nueva —eso pasa solo— pero sirve para
consolidar la referencia y revisar la clasificación completa. Corre solo los
lunes y jueves desde GitHub Actions, y sube el cambio si lo hay.

Un CER nuevo que pague cupón aparece como "sin resolver" hasta que se carguen
sus condiciones en `CONDICIONES_CER`.

El calendario de feriados bursátiles de `conventions.ts` hay que mantenerlo al
día: un feriado faltante corre la fecha de liquidación un día y mueve
visiblemente la tasa de los papeles cortos.
