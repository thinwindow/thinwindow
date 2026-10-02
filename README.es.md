<div align="center">

![Logo de ThinWindow](assets/icon.iconset/icon_128x128.png)

</div>

<h1 align="center">ThinWindow</h1>

<p align="center">
  <strong>Menos en la ventana. Menos en la factura.</strong><br>
  ThinWindow hace que Claude use menos contexto, sin cambiar el resultado. Un plugin y Agent Skill para Claude Code, Cowork y las apps de Claude, medido en Claude Code con Opus 5.5, Sonnet 5.5 y Haiku 4.5: entre un 7% y un 11% menos de costo y entre un 3% y un 6% menos de tokens.<br>
  Listado en el directorio oficial de plugins de Claude Code.
</p>

<p align="center">
  <a href="docs/WHERE-THE-TOKENS-GO.md"><b>Adónde van los tokens</b></a> (en inglés) · <a href="#benchmark">Benchmark y datos crudos</a> · <a href="#instalación">Instalación</a> · <a href="https://www.youtube.com/watch?v=ks1_B5Uq5Gc">Video de instalación</a>
</p>

<p align="center">
  <a href="README.md">English</a> · <b>Español</b> · <a href="README.pt-BR.md">Português</a>
</p>

<p align="center">
  <a href="https://www.youtube.com/watch?v=ks1_B5Uq5Gc"><img src="https://img.youtube.com/vi/ks1_B5Uq5Gc/maxresdefault.jpg" alt="Video: instalación de ThinWindow desde la app de escritorio de Claude" width="720"></a>
</p>

<!-- RESULTS:START -->
| Modelo | Tokens (IC 95%) | Tokens, corridas aprobadas | Costo (IC 95%) | Éxito base → ThinWindow | Cortadas por el tope de turnos | Corridas |
| --- | ---: | ---: | ---: | :---: | :---: | ---: |
| Opus 5.5 | −2,9% (−13,3% a +9,3%) | −2,9% | −10,5% (−16,5% a −3,0%) | 24/24 → 24/24 | 0/24 → 0/24 | 48 |
| Sonnet 5.5 | −2,6% (−23,1% a +17,5%) | −2,6% | −6,5% (−20,0% a +7,6%) | 24/24 → 24/24 | 0/24 → 0/24 | 48 |
| Haiku 4.5 | −3,3% (−19,1% a +12,2%) | −5,8% | −7,7% (−21,8% a +3,5%) | 12/16 → 12/16 | 5/16 → 5/16 | 32 |

Las mismas 8 tareas, 128 corridas, un agente por corrida, sin descartar
ninguna: todas las que se registraron están en la tabla, salvo las que reemplazó
una versión posterior del código en la misma tarea, que se guardan en
[`bench/results/archive/`](bench/results/archive). El detalle por tarea y los
datos crudos están en [Benchmark](#benchmark).
Todas las corridas se midieron en Claude Code, no en Cowork ni en las apps de Claude; las versiones posteriores a 0.3.0 van a sumar esas mediciones. Haiku 4.5 tiene dos corridas por tarea y condición; Opus 5.5 y Sonnet 5.5, tres. Las corridas salieron de dos cuentas cuyas sesiones de Claude Code arrancan con herramientas integradas distintas; las dos condiciones de cada tarea tienen la misma mezcla.

La cifra de arriba, entre un 3% y un 6%, cuenta solo las corridas que pasaron su verificación oculta. En Haiku 4.5 eso da −5,8% sobre las 6 tareas en las que ambas condiciones tienen una corrida aprobada, frente a −3,3% sobre las 8. Opus 5.5 y Sonnet 5.5 pasaron todas las corridas. IC 95%: bootstrap sobre las tareas. Donde incluye el cero, el cambio no se distingue de ninguno en este conjunto de tareas. Una corrida cortada por el tope de turnos terminó en el límite antes de que el agente acabara; sus tokens no son comparables con los de una corrida terminada.
<!-- RESULTS:END -->

## Por qué lo que se paga es el contexto

Un agente de código no paga sobre todo por lo que escribe. Paga por lo que
arrastra. Cada archivo que abre, cada log de instalación que imprime y cada grep
amplio que corre se agrega a la conversación, y la conversación entera se
reenvía en cada turno posterior. El costo de una sesión se parece más a

```
tokens ≈ tamaño del contexto × turnos
```

que a la longitud de la respuesta. En las corridas base medidas aquí, **entre el 90% y
el 95% de los tokens facturados fueron lecturas de caché** — contexto reenviado,
turno tras turno — frente a entre el 0,8% y el 1,4% de la salida del propio agente:

<!-- CACHE:START -->
| Modelo | Proporción de | Lecturas de caché | Escrituras de caché | Salida |
| --- | --- | ---: | ---: | ---: |
| Opus 5.5 | tokens | 91,7% | 6,9% | 1,4% |
|  | costo | 18,1% | 54,6% | 27,2% |
| Sonnet 5.5 | tokens | 89,7% | 8,9% | 1,4% |
|  | costo | 26,7% | 52,9% | 20,4% |
| Haiku 4.5 | tokens | 95,5% | 3,7% | 0,8% |
|  | costo | 45,7% | 35,5% | 18,7% |
<!-- CACHE:END -->

Con precios, las mismas corridas se ven distintas (las filas de costo): una
lectura de caché cuesta una décima parte de un token de entrada o menos, una
escritura de caché el doble de uno, y la salida cinco veces uno. Pedirle al
agente que sea breve toca la columna de salida, que es pequeña en tokens pero no
en costo. Evitar que se traiga un archivo de 2.000 líneas al contexto en el
turno 3 toca las dos columnas de caché, en todos los turnos que siguen.

ThinWindow ataca los dos factores: achica lo que entra al contexto y evita los
turnos extra que se gastan lidiando con una salida que el agente nunca necesitó.
Cómo se reparte la factura por tipo de token, qué llama el agente y qué pasa
con las corridas que no terminan: [Where the tokens go](docs/WHERE-THE-TOKENS-GO.md)
(en inglés).

## Instalación

**Desde el directorio de plugins** (Claude Code, Cowork y las apps de Claude):
en la app de escritorio de Claude, Customize → Plugins → Discover → ThinWindow;
en Claude Code, `/plugin` → Discover → ThinWindow, o:

```
claude plugin install thinwindow@anthropic-plugin-directory
```

[Video de la instalación desde la app de escritorio de Claude](https://www.youtube.com/watch?v=ks1_B5Uq5Gc).
En las apps de Claude los plugins no ejecutan hooks, por lo que allí ThinWindow
funciona solo como Agent Skill; el benchmark se midió en Claude Code.

**Claude Code** (reglas + hooks, la versión completa):

```
/plugin marketplace add thinwindow/thinwindow
/plugin install thinwindow@thinwindow
```

**Cualquier agente con Agent Skills** (Codex, Cursor, Copilot, Gemini CLI,
OpenCode...), solo las reglas:

```
npx skills add thinwindow/thinwindow
```

**Agentes que leen `AGENTS.md`**: basta con pegar
[`adapters/AGENTS.md`](adapters/AGENTS.md) en el `AGENTS.md` del proyecto.

Se desactiva en cualquier momento con `THINWINDOW=off` o con `"enabled": false`
en `.thinwindow.json`.

## Cómo funciona

1. **Reglas** ([`rules/thinwindow.md`](rules/thinwindow.md), menos de 500 tokens)
   cargadas al inicio de la sesión: localizar antes de leer, leer por rangos, acotar
   la salida de los comandos, escribir el cambio más pequeño, cerrar con tres
   líneas como máximo.
2. **Hooks** (solo en Claude Code) que hacen cumplir la parte cara sin que el
   agente gaste un turno:
   - Un `Read` completo de un archivo de más de 400 líneas devuelve las primeras
     120 líneas más un índice numerado, para que la lectura siguiente apunte a un
     rango.
   - Se rechaza releer un archivo sin cambios que ya está en el contexto.
   - Instalaciones, builds, tests y linters pasan por `thinwindow-run`: el log
     completo va a un archivo temporal y el agente ve el código de salida, el
     final del log y las líneas de error. Cuando no habría nada que cortar (10
     líneas o menos si termina bien, 40 si falla), la salida vuelve tal cual,
     con el código de salida si el comando falló.
   - `cat` de archivos enormes, lockfiles o archivos minificados, `git log` sin
     `-n`, `ls -R`, `tree` sin `-L` y `find` sin límite reciben una alternativa más
     barata. El `Grep` por contenido recibe `head_limit: 100`.
3. **Falla en modo abierto.** Cualquier error de un hook deja pasar la llamada.
   Repetir una lectura o un comando ruidoso rechazados también los deja pasar,
   y los pocos comandos que siempre se rechazan vienen con un reemplazo que
   funciona, así que el agente nunca se queda bloqueado.

Las reglas las hacen cumplir los hooks en lugar de dejarlas en manos del modelo,
porque una regla que el agente puede olvidar bajo presión no es una regla. Los hooks corren
sobre la llamada a la herramienta, antes de que el resultado llegue al contexto,
así que aplicarlas no cuesta un turno.

Sin dependencias, sin telemetría, Node 18+. Detalles y todas las opciones:
[docs/configuration.md](docs/configuration.md).

### Qué lee, qué escribe y qué envía

- **Lee:** la llamada de herramienta que Claude Code le pasa a los hooks (una
  ruta, un comando o un patrón de búsqueda); la cantidad de líneas y un índice
  de los archivos que el agente está por leer o imprimir; su configuración en
  `.thinwindow.json`, en el proyecto y en la carpeta del usuario; y las
  variables de entorno `THINWINDOW`, `THINWINDOW_DEBUG` y `CLAUDE_PROJECT_DIR`.
  No lee credenciales.
- **Escribe:** solo en el directorio temporal del sistema operativo: un JSON
  pequeño por sesión (qué archivos y rangos se leyeron, los rechazos recientes y
  el conteo de lo que hicieron los hooks) y el log completo de cada comando que
  pasa por `thinwindow-run`. Los dos se borran a los 7 días.
- **Envía:** nada. No tiene código de red.

## Benchmark

<!-- BENCH:START -->
Tres modelos, 8 tareas, 128 corridas. Los gráficos y las tablas los genera
[`bench/report.mjs`](bench/report.mjs) a partir de los archivos crudos.

### Opus 5.5

![Cambio en tokens totales por tarea, Opus 5.5: a la izquierda del cero, menos tokens con ThinWindow; los bigotes cubren cada par de corridas](bench/results/chart-claude-opus-5-5.svg)

### Sonnet 5.5

![Cambio en tokens totales por tarea, Sonnet 5.5: a la izquierda del cero, menos tokens con ThinWindow; los bigotes cubren cada par de corridas](bench/results/chart-claude-sonnet-5-5.svg)

### Haiku 4.5

![Cambio en tokens totales por tarea, Haiku 4.5: a la izquierda del cero, menos tokens con ThinWindow; los bigotes cubren cada par de corridas](bench/results/chart-claude-haiku-4-5.svg)
<!-- BENCH:END -->

Las tablas por tarea, con la dispersión y la tasa de éxito, están en
[`bench/results/report.md`](bench/results/report.md) y en la
[sección Benchmark del README en inglés](README.md#benchmark) (se generan en
inglés y no se duplican aquí, para que estén siempre al día). Las corridas
crudas, una línea por corrida, están en [`bench/results/`](bench/results).

### Cómo se mide

Cada **corrida** es un agente resolviendo una tarea desde cero:

1. Clonar un repositorio real de código abierto
   ([click](https://github.com/pallets/click) o
   [commander.js](https://github.com/tj/commander.js)) en un commit fijo, dentro
   de un directorio temporal nuevo.
2. Instalar sus dependencias antes de que arranque el agente, para que los logs
   de instalación no se le facturen a ninguna de las dos condiciones.
3. Correr `claude -p "<tarea>"` con el modelo elegido, con un tope de 40 turnos.
   La condición *baseline* usa Claude Code sin modificaciones; *ThinWindow* usa
   lo mismo más este plugin. No cambia nada más: sin servidores MCP, sin configuración de usuario,
   sin memoria entre corridas.
4. Correr la verificación oculta de la tarea: un test o un script que el agente
   nunca ve. Código de salida 0 es éxito.
5. Registrar tokens (entrada, escrituras y lecturas de caché, salida,
   subagentes incluidos), costo, turnos y tiempo desde el JSON que devuelve
   Claude Code, más la traza completa de llamadas a herramientas.

Las 8 tareas son una mezcla de trabajo cotidiano: correcciones de bugs con un
test que falla, una funcionalidad pequeña, un renombrado entre archivos, un
refactor, una consulta de configuración y "que el año del copyright del pie de página se actualice solo".
Las definiciones están en [`bench/tasks/`](bench/tasks).

Las corridas son secuenciales, una por una, para que nunca compitan por los
límites de uso. El costo es el precio equivalente de API que informa Claude Code; con una
suscripción se paga en límites de uso, pero la proporción es la misma.

### Cómo verificarlo

- Cada corrida es una línea de JSONL en [`bench/results/`](bench/results), con
  el modelo, la versión de Claude Code, el commit de ThinWindow, los conteos de
  tokens crudos y la traza de herramientas. Ningún número de este README está
  escrito a mano.
- Las reglas se ajustaron sobre esas mismas 8 tareas, en dos bibliotecas de
  parseo de argumentos de línea de comandos, en JavaScript y Python. Es una
  porción acotada del software que existe. En otros proyectos, el ahorro será
  distinto.
- Las muestras son pequeñas. Los agentes varían mucho: la misma tarea tomó 7
  turnos en una corrida y 13 en la siguiente (click-help-spec en Sonnet 5.5,
  sin ThinWindow), por eso las tablas muestran medianas y el rango por tarea, y
  no un único promedio de titular.
- Cualquiera puede ejecutarlo con su propia cuenta y sus propios límites:

  ```
  node bench/run.mjs --condition baseline,thinwindow --reps 3 --model sonnet --dry-run
  node bench/run.mjs --condition baseline,thinwindow --reps 3 --model sonnet --max-cost 10
  node bench/report.mjs
  ```

  Todas las opciones están en [bench/README.md](bench/README.md).

### Dónde queda margen

Estos números son una medición actual, no un techo. Se van a mover a medida que
cambien las reglas, los modelos y el propio Claude Code, y la idea es seguir
mejorándolos y volver a publicar los archivos crudos cada vez.

En los datos se ven dos cosas:

- **No todas las tareas mejoran.** En Sonnet 5.5, seis de las ocho tareas usan más
  tokens con ThinWindow que sin él; en Opus 5.5 y Haiku 4.5, cinco. Solo con
  neutralizar esas regresiones —sin ahorrar un token más en ningún otro lado—
  Sonnet 5.5 pasaría de −2,6% a cerca de −13,1%, Opus 5.5 de −2,9% a cerca de
  −7,4% y Haiku 4.5 de −3,3% a cerca de −10,2%. El margen de
  corto plazo está más en no empeorar las tareas cortas que en exprimir las
  largas. Lo que muestran las trazas de cada una está en
  [#7](https://github.com/thinwindow/thinwindow/issues/7).
- **Los turnos son el factor todavía sin aprovechar.** Como el costo es aproximadamente
  contexto × turnos, un turno ahorrado vale tanto como una lectura grande
  evitada. Sonnet 5.5 usó un 5,4% menos de turnos aquí y recortó el costo un 6,5%;
  Haiku 4.5 usó un 6,1% más de turnos y recortó el costo un 7,7%; Opus 5.5 usó
  un 1,3% más de turnos y recortó el costo un 10,5%.
  Un intento previo de reglas explícitas de "usar menos turnos" empeoró los
  resultados de Sonnet 5 de forma medible y se revirtió, en lugar de mantenerse y
  excluirse en silencio: ese experimento revertido sigue en el historial.

## Qué hace ThinWindow con la salida de las herramientas

Estas cifras miden el tamaño de la salida de las herramientas, no el costo.
Salen de una repetición sin modelo: cada llamada a Read y Bash de las corridas
base se vuelve a ejecutar, en un clon nuevo del repositorio de su tarea, una vez
tal como la mandó el agente y otra como la reescriben o la rechazan los hooks
de ThinWindow, y se comparan los caracteres que el agente recibiría. Las
llamadas que miran los cambios del propio agente (`git diff`, los tests) ven el
repositorio sin modificar, así que sus tamaños no son los que vio el agente. La
repetición es determinista salvo por los tiempos y las rutas temporales de la
salida, que mueven los totales unos pocos caracteres de una repetición a otra.
No necesita clave de API; necesita red para los clones y la instalación de
dependencias, y tarda de 15 a 25 minutos en una laptop, casi todo en volver a
correr los tests: `node bench/input-size.mjs`, que escribe
[`bench/results/input-size.json`](bench/results/input-size.json).

Reducir la salida de las herramientas no es reducir la factura. La salida de
las herramientas es una parte de lo que entra al contexto; el contexto es una
parte de los tokens; y los tokens son una parte del costo, cada tipo a su
precio. El efecto se diluye en cada paso.
[Where the tokens go](docs/WHERE-THE-TOKENS-GO.md) (en inglés) muestra cómo se
reparte la factura.

<!-- TIER1:START -->
| Modelo | Llamadas en las trazas base | Repetidas | Cambiadas por los hooks | Salida de las llamadas repetidas (caracteres) | Cambio |
| --- | ---: | ---: | ---: | ---: | ---: |
| Opus 5.5 | 106 | 52 | 2 | 83.849 → 83.856 | +0,0% |
| Sonnet 5.5 | 0 | 0 | 0 | 0 → 0 | – |
| Haiku 4.5 | 366 | 250 | 37 | 861.927 → 515.933 | −40,1% |

Sin repetir: 183 llamadas que la traza cortó (guarda 140 caracteres de cada una), 33 que escriben archivos, corren un script o cambian el repositorio, y 22 cuyo archivo no se pudo identificar.

El cambio en la factura es otra magnitud, medida en [Benchmark](#benchmark), y no del mismo tamaño:
- Opus 5.5: los hooks cambian 2 de 106 llamadas y agrandan la salida repetida un 0,0%; en el benchmark actuaron en 1 de 24 corridas con ThinWindow, y el cambio medido en el costo es −10,5% (IC 95% −16,5% a −3,0%).
- Sonnet 5.5: los hooks cambian 0 de 0 llamadas y agrandan la salida repetida un 0,0%; en el benchmark actuaron en 3 de 24 corridas con ThinWindow, y el cambio medido en el costo es −6,5% (IC 95% −20,0% a +7,6%).
- Haiku 4.5: los hooks cambian 37 de 366 llamadas y recortan la salida repetida un 40,1%; en el benchmark actuaron en 10 de 16 corridas con ThinWindow, y el cambio medido en el costo es −7,7% (IC 95% −21,8% a +3,5%).

Donde los hooks casi no actúan, el cambio medido viene de las reglas, que cambian lo que hace el agente, o del ruido entre corridas, no de recortar la salida de las herramientas.
<!-- TIER1:END -->

## Contribuir

Este es justo el tipo de proyecto que mejora con las cargas de trabajo de otras
personas, porque los límites de arriba son los límites de la muestra de *una sola
persona*.

Lo más útil, más o menos en orden:

1. **Resultados de benchmark con otros stacks.** Una tarea nueva en
   [`bench/tasks/`](bench/tasks) —otro lenguaje, un monorepo, un framework con
   mucho código generado— vale más que una opinión sobre las reglas.
2. **Una regresión reproducible.** Un caso donde ThinWindow salga más caro que
   la baseline, con el JSONL que lo demuestre, es un regalo: las regresiones de
   arriba son el camino más claro a mejores números.
3. **Propuestas de reglas y hooks**, con la medición que las justifique. Las
   reglas se prueban contra el benchmark, no se aceptan por lo razonables que
   suenen; además el archivo de reglas tiene un presupuesto de tokens que la
   CI hace cumplir.

El flujo está en [CONTRIBUTING.md](CONTRIBUTING.md).

## Alcance, limitaciones y descargo

ThinWindow empezó como una herramienta personal, pensada para abaratar un flujo
de trabajo propio. Se publicó porque las mediciones pueden servirles a otras
personas, no porque sea un producto terminado con un contrato de soporte detrás.

Conviene leer los números con eso en mente:

- **El benchmark es acotado y lo eligió el autor.** Ocho tareas, dos
  repositorios, tres modelos y pocas repeticiones por modelo, todo elegido por el
  autor, con reglas ajustadas sobre esas mismas tareas. Alcanza para mostrar una
  dirección, no para prometer un porcentaje. Se publica completo, con los
  archivos crudos, precisamente para que cada quien juzgue cuánto se generaliza
  en lugar de confiar en un número de titular.
- **La contabilidad de tokens es volátil por naturaleza.** Lo que termina en una
  ventana de contexto depende de la versión del modelo, del entorno de ejecución del
  agente y su prompt de sistema, de la tasa de aciertos de caché, de qué herramientas
  están habilitadas, de los servidores MCP, del tamaño del repositorio y de cómo
  se desarrolle la tarea ese día. Cualquiera de esos factores puede mover el
  resultado más que el efecto medido aquí. Dos corridas idénticas de la misma
  tarea pueden diferir bastante; las medianas y los rangos de las tablas están
  para que eso se vea, no para taparlo.
- **Los resultados envejecen.** Se midieron con una versión concreta de Claude
  Code y con snapshots concretos de los modelos, y las dos cosas cambian
  seguido. Se van a volver a medir en lugar de quedar publicados sin revisión.
- **Sin garantía.** Este software se entrega "tal cual" bajo la
  [licencia MIT](LICENSE), sin garantía de ningún tipo. Cada usuario es
  responsable de lo que se ejecuta en su entorno y de lo que gasta. Los hooks
  están diseñados para fallar en modo abierto y nunca bloquear una llamada, y
  los tests cubren ese comportamiento, pero ninguna cantidad de tests es una garantía: conviene revisar
  el código, correr los tests y probarlo en una rama antes de confiarle trabajo
  real.
- **No reemplaza un buen prompt.** Elimina desperdicio; no hace más inteligente al
  agente.

## Preguntas frecuentes

**¿Hace que el agente rinda peor?** Para eso está la columna de éxito en
cada tabla. Un ahorro que hace fallar la tarea no es un ahorro. En los tres
modelos el éxito fue idéntico a la baseline salvo en una tarea de Haiku,
commander-rename-display-width: 1/2 sin ThinWindow, 0/2 con él. A Haiku le
cuesta esa tarea de cualquier forma: fallaron tres de sus cuatro corridas, y
todas tomaron 35 turnos o más.

**¿Por qué no pedirle al agente que sea breve?** Ayuda, y las reglas lo piden:
la salida es apenas entre el 0,8% y el 1,4% de los tokens, pero a cinco veces
el precio de la entrada es entre el 19% y el 27% del costo (ver [Por qué lo que
se paga es el contexto](#por-qué-lo-que-se-paga-es-el-contexto)). El resto es
contexto: una respuesta larga se paga una vez, mientras que una lectura larga se
escribe en la caché una vez y se vuelve a leer en cada turno que sigue.

**¿Envía código o telemetría a alguna parte?** No. En este proyecto no hay
código de red: sin analíticas, sin reportes de error, sin "estadísticas anónimas
de uso", sin chequeo de licencia ni de actualizaciones. Los hooks son scripts
locales de Node que leen la llamada a la herramienta y devuelven una decisión;
los logs recortados van a un archivo temporal en el disco local. Lo único que
sale de la máquina es lo que el agente ya le enviaba al proveedor de modelos, y
el objetivo de esta herramienta es que eso sea menor.

**¿Funciona fuera de Claude Code?** Las reglas sí, vía Agent Skills o
`AGENTS.md`. Los hooks —que hacen el trabajo pesado— son solo de Claude Code,
porque dependen de su API de hooks sobre llamadas a herramientas.

## Licencia

MIT
