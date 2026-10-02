# Monitor Mercado

Monitor del mercado argentino en pesos: curva de tasa fija,
curva CER e inflación breakeven, con datos públicos de BYMA, BCRA e INDEC.

**En vivo: <https://monitor-mercado-4net.vercel.app>**

![Curva CER, inflación breakeven y tabla de precios](docs/img/tasa-cer.png)

## Qué muestra

- **Tasa fija.** LECAPs y BONCAPs: curva de TIR o TEM contra el plazo, y
  tabla con precio, variación del día, pago final y volumen.
- **CER.** BONCER y LECER cero cupón, bonos con cupón, los del canje y los
  duales CER/TAMAR: TIR real contra duration y capital ajustado por CER.
- **Inflación breakeven.** La inflación de cada mes que descuenta el mercado
  al comparar las dos curvas, alineada con los meses del INDEC.
- **Historia.** Cada curva se puede comparar con la de cualquier rueda
  anterior.

## Cómo está hecho

- **Todo el cálculo vive en el backend.** El navegador pide un JSON ya
  calculado y sólo dibuja. Las convenciones (base de días, liquidación T+1,
  feriados, rezago del CER) están en un único archivo.
- **Sin dato inventado.** Cada precio lleva fecha y origen; lo dudoso se
  marca y sale de la curva, y lo que falta se informa en vez de estimarse.
- **Se mantiene solo.** Los papeles nuevos entran y los vencidos salen sin
  tocar código. GitHub Actions guarda la foto de cada cierre y refresca la
  referencia de especies.
- **Breakeven validado.** Sigue el método de la Nota Técnica N°8/2024 del
  BCRA y se controla todos los días contra pares de bonos del mismo
  vencimiento.

El detalle de cada decisión está en [`docs/`](docs):

| documento | contenido |
|---|---|
| [Curvas](docs/curvas.md) | convenciones de cálculo, ajuste de la curva, rendimiento real de los CER |
| [Breakeven](docs/breakeven.md) | método, mapeo a meses INDEC, controles, por qué logaritmo y no Nelson-Siegel |
| [Datos](docs/datos.md) | fuentes, límites de BYMA, calidad del dato, historia, mantenimiento |
| [Arquitectura](docs/arquitectura.md) | rutas, módulos, comandos de validación, procesos automáticos |

## Stack

Next.js (App Router) y TypeScript, desplegado en Vercel. Gráficos en SVG
propio, sin librerías de charting. Sin base de datos y sin variables de
entorno: todas las fuentes son públicas.

## Correr en local

```bash
npm install
npm run dev
```

Abre en <http://localhost:3000>.

| comando | qué hace |
|---|---|
| `npm run build` | build de producción |
| `npm run typecheck` | chequeo de tipos |
| `npm run validate` | imprime una curva calculada, sin levantar Next |
| `npm run validate:breakeven` | tabla del breakeven por mes INDEC |
| `npm run validate:modelos` | compara modelos de curva sobre la historia guardada |
| `npm run historico:guardar` | guarda la foto del último cierre |
| `npm run refresh:reference` | regenera la referencia de especies desde BYMA |

## Estructura

    src/app/          páginas y endpoints (/api/universe, /api/breakeven)
    src/components/   curva, tabla, panel de breakeven, selectores
    src/lib/          cálculo: convenciones, valuación, ajuste, breakeven
      sources/        BYMA, BCRA, INDEC
      universes/      definición de cada curva; sumar una no toca el resto
      reference/      especies vigentes, generado
    scripts/          validación e historia, por línea de comandos
    public/historico/ una foto por rueda y por curva
    docs/             metodología

## Fuentes

[BYMA](https://open.bymadata.com.ar) para precios, el
[BCRA](https://www.bcra.gob.ar) para el CER y el
[INDEC](https://www.indec.gob.ar), por la API de Series de Tiempo, para el
IPC.
