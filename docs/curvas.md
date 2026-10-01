# Curvas: convenciones y cálculo

Cómo se calcula cada rendimiento y cómo se arma cada curva. Volver al [README](../README.md).

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

## La curva CER

Sale de **los mismos dos paneles de BYMA y con el mismo criterio de precio**
que tasa fija. No es un detalle: el breakeven compara las dos curvas, y
cualquier diferencia de fuente u horario entre ellas se convierte en error.
Las dos se piden en la misma consulta.

### Rendimiento real

El capital de un CER se ajusta por el coeficiente que publica el BCRA, con un
rezago que fija cada emisión y es el mismo en todas: el CER "correspondiente
al período transcurrido entre los 10 días hábiles anteriores a la fecha de
emisión y los 10 días hábiles anteriores a la fecha de vencimiento" (ficha
técnica de BYMA).

    capital ajustado = 100 × CER(liquidación − 10 háb) / CER(emisión − 10 háb)
    TIR real         = la tasa que iguala el precio con los flujos ajustados

El CER del vencimiento todavía no existe y no se estima: todo se mide en CER
de hoy. En un cero cupón queda `(capital ajustado / precio)^(365/días) − 1`.
Las tasas reales cortas pueden ser negativas y no es un error.

### Qué papeles y cómo

| estructura | papeles | cómo se valúa | entra al breakeven |
|---|---|---|---|
| cero cupón | TZX*, X* | un solo flujo | sí |
| con cupón | TX26, TX28, TX31, DICP, DIP0, PARP, PAP0, CUAP | TIR sobre renta y amortizaciones | no |
| dual CER/TAMAR | TXM* | TIR de la pata CER, un piso | no |

**En pantalla** la curva CER se dibuja contra la **duration**, no contra el
plazo al vencimiento: un bono que paga cupón promedia varios plazos y ése es
el que lo compara con el resto (en un cero cupón coinciden). Todos los papeles
entran al ajuste de la pantalla y se sacan o ponen con su ficha, como en tasa
fija. Tasa fija, que es toda cero cupón, sigue contra los días al vencimiento.

**Para el breakeven** cuentan sólo los cero cupón: miden una tasa pura a cada
plazo. Un bono con cupón promedia plazos y un dual trae una opción adentro que
le baja la TIR "CER".

En las dos curvas la tasa anual se muestra como **TIR**: es la tasa efectiva
anual que iguala el precio con los flujos, que en un cero cupón es la TEA.

Las condiciones de los que pagan cupón viven en `tasa-cer-condiciones.ts`
porque la ficha las trae en texto libre. Los del canje de 2005 capitalizaron
parte de los intereses hasta 2013: el Discount por 1,269937 y el Cuasipar
por 1,388593. Se verificaron contra un flujo publicado por terceros y las TIR
coinciden al centésimo.

DICPD no está: es el mismo DICP (mismo ISIN) cotizando en dólares, y su TIR
real sería la del DICP por construcción.

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
