# PesoDólar

TRM oficial de Colombia en vivo, forwards COP/USD y proyecciones de tasas por
regla de Taylor.

Una sola página HTML: sin backend, sin build, sin dependencias. Se instala como
app en celular y computador.

## Importante: ábrela desde una dirección web

Si abres `index.html` con doble clic, el navegador **bloquea todas las consultas
de red** (origen `file://`). La TRM y las tasas no se podrán actualizar nunca.
La app lo detecta y te lo avisa, pero la solución es publicarla:

```bash
# Para probar en local, sirviéndola por HTTP:
python3 -m http.server 8080
# y abrir http://localhost:8080
```

Para uso diario, publícala (ver abajo) y ábrela desde su URL.

## Qué hace

**TRM & Forwards** — TRM oficial automática al abrir, variación del día,
devaluación del año, mínimo y máximo de 90 días, gráfico histórico, y forwards
a 3, 6, 12 y 18 meses por paridad cubierta de tasas.

**Tasas & Usura** — Tasa BanRep, IBR, DTF (promedio de CDT a 90 días),
inflación, IBC y usura. Proyección por regla de Taylor. **Funciona sin
conexión**: el modelo solo usa las tasas guardadas.

**Proyecciones TRM** — Cuadro comparativo por fuente. El forward implícito se
calcula solo; las proyecciones de bancos las anotas tú, con enlace a cada
informe.

**Diagnóstico** — Prueba cada fuente y dice exactamente qué falla y por qué, con
un botón para copiar el resultado. Si algo no funciona, esta pestaña lo explica.

## Fuentes de datos

| Fuente | Qué entrega | Automática |
|---|---|---|
| [Datos Abiertos](https://www.datos.gov.co/Econom-a-y-Finanzas/Tasa-de-Cambio-Representativa-del-Mercado-TRM/32sa-8pi3) `32sa-8pi3` | TRM oficial + histórico | Sí |
| [NY Fed](https://markets.newyorkfed.org) | SOFR | Sí |
| Datos Abiertos `ev8i-uzwt` | IBR overnight | Sí |
| Datos Abiertos `gtwv-4pxq` | DTF | Sí |
| [open.er-api.com](https://open.er-api.com) | Cotización de respaldo | Sí |
| Superfinanciera | Usura e IBC | Solo con GitHub Actions |
| BanRep, DANE | Tasa de política, inflación | Manual |

Lo que no se trae solo viene precargado con su fecha de corte y es editable. El
**panel de vigencia** avisa cuándo toca revisar cada dato, con enlace directo a
la fuente.

### Sobre la DTF

Promedio ponderado de las tasas de CDT a 90 días, calculado semanalmente por el
Banco de la República. Si la descarga falla, la app la **estima desde el IBR** y
lo rotula: la norma establece que desde el 1 de enero de 2027 toda referencia a
DTF pasa al IBR a 3 meses, así que el regulador las trata como equivalentes.

> **La DTF desaparece el 1 de enero de 2027.** Si tienes créditos o CDT
> indexados a DTF, ese es el cambio que hay que mirar.

## Cómo se proyectan las tasas

No se traza una recta a partir de un porcentaje escrito a mano. El modelo es una
**regla de Taylor con suavizamiento**, la función de reacción estándar con la
que se representa a un banco central.

```
i* = r* + π + a(π − meta) + b·brecha     nivel que pide la regla
π₊ = meta + (π − meta)·λ                 la inflación converge
i₊ = ρ·i + (1−ρ)·i*                      la tasa se acerca gradual
```

DTF, IBC y usura conservan el **margen que hoy se observa** frente a la tasa de
política: se calibran con los datos vigentes, no con coeficientes inventados. La
usura es `IBC × 1,5`, que es regla legal.

El modelo converge al estado estacionario correcto: con la inflación en la meta,
la tasa tiende a `r* + meta` (relación de Fisher).

Los cuatro escenarios son configuraciones distintas de los parámetros, no
pendientes distintas. Todos los parámetros son editables.

## Cómo se calculan los forwards

Paridad cubierta de tasas de interés:

```
F = S × (1 + r_COP × T/360) / (1 + r_USD × T/360)
```

Devaluación implícita anualizada: `(F/S − 1) × (360/T) × 100`.

Un forward **no es un pronóstico**: es el precio de cubrirse hoy, y refleja el
diferencial de tasas entre los dos países.

## Publicar

**Netlify** — arrastra la carpeta a [app.netlify.com/drop](https://app.netlify.com/drop)

**GitHub Pages** — Settings → Pages → Deploy from branch → `main` / root

**Vercel** — `npx vercel --prod`

Con la URL abierta en el teléfono:

- **iPhone (Safari)** — compartir → *Agregar a pantalla de inicio*
- **Android (Chrome)** — ⋮ → *Instalar aplicación*

## Actualización automática (opcional)

`.github/workflows/actualizar-datos.yml` consulta las fuentes cada día hábil y
escribe `datos.json` junto a la app. Cuando ese archivo existe, la app lo lee en
una sola petición y toma de ahí IBR, DTF, SOFR, usura e IBC.

Para activarlo: **Settings → Actions → General → Workflow permissions** y marca
*Read and write permissions*. Luego dispáralo a mano desde **Actions** para
comprobar que corre.

El script falla sin hacer daño: cada fuente es independiente, todo valor pasa
por control de rango, y si una consulta falla se conserva el valor anterior en
vez de borrarlo.

La parte que lee usura e IBC raspa el HTML de la Superintendencia Financiera,
que no ofrece API. Si esa página cambia de maqueta dejará de encontrar el
número; el valor anterior se mantiene y aparece como `sin_actualizar`.

## Archivos

```
index.html                              toda la app
manifest.json  sw.js  icon-*.png        instalación como app y modo sin conexión
scripts/actualizar.mjs                  consulta fuentes y escribe datos.json
.github/workflows/actualizar-datos.yml  lo corre cada día hábil
```

## Licencia

MIT
