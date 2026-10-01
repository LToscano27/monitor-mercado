# Inflación breakeven

Método, mapeo a meses INDEC y controles. Volver al [README](../README.md).

## Inflación breakeven

Método **encadenado sobre curvas ajustadas**. No se compara bono contra bono
—los vencimientos no coinciden y el encadenado amplifica el ruido de cada
precio—: se evalúan las dos curvas ajustadas en las mismas fechas.

    1 + BE acumulado(t) = (1 + TEA nominal)^(d/365) / (1 + TEA real)^(d/365)
    π(t1 → t2)          = (1 + BE(t2)) / (1 + BE(t1)) − 1

Nunca se extrapola: el último mes es el último que cubren **las dos** curvas,
y hoy el techo lo pone tasa fija.

**Precios de cierre.** El breakeven sale de los cierres de la última rueda
terminada: con el mercado abierto, los del día hábil anterior; al cerrar
(17:20 reales, cuando el feed termina de publicar) pasa solo a los del día.
Es un dato para leer una vez por día, no uno que se mueva con cada operación.
Las curvas de la pantalla sí van en vivo.

**La curva real se ajusta sólo en el tramo que se usa.** La CER llega a 2029
y la de tasa fija a unos nueve meses. Ajustada entera, la forma logarítmica
se empina para alcanzar los reales del 10% a dos y tres años y queda uno o
dos puntos por encima de los papeles entre los cuatro y los doce meses,
justo donde se calcula: bajaba el breakeven unos 0,15 puntos por mes. Para
el breakeven se ajusta con los cero cupón hasta el plazo de tasa fija más un
papel. La curva de la pantalla sigue con todos.

### Por qué curvas y no pares

Con dos títulos que vencen el mismo día, el breakeven acumulado a esa fecha
es exacto y no necesita ninguna curva. Pero la inflación **de cada mes**
no se puede sacar así: hay pares para pocos vencimientos (meses enteros
quedan sin dato), y restar el acumulado de un par del siguiente carga todo
el error de precio de un papel en un solo mes. Con precios del 25/09/2026,
los pares de abril, mayo y junio de 2027 daban 2,27% un mes y 1,50% el
siguiente.

Es la práctica de los bancos centrales: la Reserva Federal y el Banco de
Inglaterra ajustan una curva nominal y una real y sacan de ahí la inflación
implícita a cada plazo ([Gürkaynak, Sack y Wright,
2010](https://www.federalreserve.gov/pubs/feds/2008/200805/200805pap.pdf);
[Banco de Inglaterra](https://www.bankofengland.co.uk/statistics/details/further-details-about-yields-data)).
Usan formas más flexibles —Svensson, splines— porque tienen decenas de bonos
por curva; con los diez de tasa fija, una forma de dos parámetros es lo que
se sostiene. En la plaza local lo más común son los pares o promedios por
tramo de plazo, que dan el nivel pero no el perfil mensual.

### Por qué logaritmo y no Nelson-Siegel

El método es el de la [Nota Técnica N°8/2024 del
BCRA](nota-tecnica-bcra-8-2024.pdf) ("Expectativas de inflación implícitas en el
mercado de renta fija argentino") —Fisher sobre curvas ajustadas, el CER partido
en lo conocido y lo que falta, los cortes alineados con el día 15— con una
diferencia: el BCRA ajusta las curvas con Nelson-Siegel y acá se usa
`TEA = a + b·ln(días)`.

Se probó el 01/10/2026 sobre las once ruedas guardadas (16/09 al 30/09), con
τ buscado en grilla y acotado para que la joroba caiga entre los plazos con
papeles:

| | logaritmo | Nelson-Siegel |
|---|---|---|
| desvío medio contra los pares | 0,088 pp | 0,091 pp |
| salto diario medio, octubre en adelante | 0,02–0,04 pp | 0,04–0,05 pp |
| salto diario máximo, octubre y noviembre | 0,08–0,09 pp | 0,21–0,22 pp |

Nelson-Siegel no se acerca más a los pares y se mueve más de un día al otro.
Su τ va de 8 a 200 días según la rueda: con nueve papeles por curva, cuatro
parámetros copian el ruido del tramo corto. Acotar más el τ no cambia el
resultado (0,086 a 0,092 pp). El desvío contra los pares no viene de la forma
de la curva sino del precio de papeles puntuales, y eso ninguna curva suave
lo sigue.

Tampoco se suman los CER con cupón, que la nota incluye por bootstrapping.
Dentro del tramo que cubre tasa fija sólo cae TX26, al que le queda un único
pago; sumarlo empeora el control (0,096 pp). El resto tiene sus flujos mucho
más allá.

Nelson-Siegel queda implementado (`nelsonSiegel` en `src/lib/ajuste.ts`) pero
no se publica. `npm run validate:modelos` repite la comparación sobre toda la
historia guardada: vale la pena volver a correrlo cuando haya más ruedas o
más papeles por curva.

### Control contra pares

Los pares se usan igual, de control. Para cada LECAP o BONCAP que vence el
mismo día que un CER, se compara la inflación mensual promedio que da el par
con la que dan las curvas, desde el último CER publicado hasta el CER que
cobra el par. Si se apartan más de 0,10 puntos, se marca. Un par que cobra
menos de 20 días de CER por encima de lo publicado no cuenta: su promedio
"mensual" mide un puñado de días y es ruido.

### El mapeo a meses INDEC

Es lo que más cuidado lleva, porque hay dos rezagos encimados.

**1. El CER reparte cada IPC entre el 16 y el 15.** Por metodología del BCRA,
el CER del día 16 de un mes al 15 del siguiente acumula el IPC del mes
anterior. Verificado contra la serie: del 15/09 al 15/10 de 2026 el CER creció
exactamente 1,7000%, el IPC de agosto. (No es "del 10 al 9": con esa ventana
no coincide con ningún mes.)

**2. Los títulos cobran el CER de 10 hábiles antes.** Quien compra hoy recibe
el ajuste desde L = CER(liquidación − 10 hábiles), y un título que vence en t
cobra el CER de t − 10 hábiles. Comparar las dos curvas mide la inflación
esperada entre L y t − 10 hábiles.

Juntando las dos cosas, el IPC del mes m está entero en la ventana del CER
que termina el **15 de m+2**. Las fechas de evaluación se eligen para que cada
tramo termine justo ahí:

    IPC de septiembre  →  CER del 16/10 al 15/11  →  curvas leídas al plazo de L al 15/11

El plazo al que se leen las curvas es el largo de la ventana del CER, de L al
día 15. Así, que el 15 caiga en feriado o que el rezago de 10 hábiles se
estire por un fin de semana largo no mueve nada. Si se leyeran al plazo del
vencimiento, esos días de más se cargarían como inflación de ese mes y
armarían un serrucho de ±0,1 punto que es del calendario, no del mercado.

Cada tramo se informa como **tasa de 30 días**, igual que la TEM. Las
ventanas tienen el largo del mes siguiente (la de enero dura 28 días) y una
curva suave no distingue meses: sin normalizar, enero salía 0,15 puntos abajo
de sus vecinos por culpa de febrero.

### Lo que ya se publicó no es breakeven

El BCRA publica el CER hasta el 15 del mes siguiente al último IPC. El tramo
de L a esa fecha es **inflación conocida** y no se mezcla con la expectativa
de mercado: viaja en la respuesta, con el dato del INDEC, pero el panel no la
dibuja. El panel muestra sólo los meses cuya inflación todavía no se conoce;
cuando sale un dato, ese mes desaparece solo y el primero pasa a ser el
siguiente. La acumulada de abajo es el encadenado de las barras que se ven.

Un mes pasa a conocido cuando el BCRA extiende el CER hasta el fin de su
ventana, sin esperar a que datos.gob.ar actualice la serie del INDEC, que a
veces tarda uno o dos días.

El primer forward se mide contra ese CER publicado y no contra la curva, que
en ese plazo no agrega información y sólo sumaría su error de ajuste. Lo que
diría la curva ahí viaja igual en la respuesta, como control.

El INDEC publica el IPC con más decimales de los que usa el CER: agosto de
2026 fue 1,659% y el CER acumuló 1,700%, la cifra oficial redondeada a un
decimal. Los dos viajan en la respuesta.

El INDEC no es imprescindible: si datos.gob.ar no contesta, los meses
conocidos salen con lo que acumuló el CER, el breakeven se publica igual y
queda un aviso en `warnings`. El panel, además, reintenta dos veces antes de
mostrar un error, porque casi siempre es un corte de segundos de una fuente.

### Forwards raros

Un forward negativo o de más del doble del último IPC publicado sale marcado.
No es una expectativa: es un problema en el ajuste de alguna curva, y se
reporta en vez de suavizarse.
