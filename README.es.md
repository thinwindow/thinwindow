<div align="center">

![Logo de ThinWindow](assets/icon.iconset/icon_128x128.png)

</div>

<h1 align="center">ThinWindow</h1>

<p align="center">
  <strong>Menos en la ventana. Menos en la factura.</strong><br>
  Tu agente paga su contexto dos veces: una para guardarlo en caché y otra en cada turno que lo vuelve a leer. Solo las relecturas son entre el 87% y el 96% de los tokens; los dos pagos juntos, entre el 73% y el 84% de la factura. ThinWindow es un plugin de Claude Code y un Agent Skill que reduce ese contexto: entre un 13% y un 19% menos de tokens, medido en Claude Code con tres modelos, en ocho tareas de dos repositorios de Python y JavaScript.
</p>

<p align="center">
  <a href="README.md">English</a> · <b>Español</b> · <a href="README.pt-BR.md">Português</a>
</p>

<!-- RESULTS:START -->
| Modelo | Tokens (IC 95%) | Tokens, corridas aprobadas | Costo (IC 95%) | Éxito base → ThinWindow | Cortadas por el tope de turnos | Corridas |
| --- | ---: | ---: | ---: | :---: | :---: | ---: |
| Opus 5.5 | −15,8% (−28,3% a +0,4%) | −15,8% | −19,4% (−26,2% a −10,2%) | 16/16 → 16/16 | 0/16 → 0/16 | 32 |
| Sonnet 5 | −13,2% (−30,4% a +7,0%) | −13,2% | −7,9% (−18,4% a +2,5%) | 24/24 → 24/24 | 0/24 → 0/24 | 48 |
| Haiku 4.5 | −23,0% (−36,0% a −10,8%) | −18,8% | −20,2% (−30,5% a −10,9%) | 14/16 → 13/16 | 7/16 → 3/16 | 32 |

Las mismas 8 tareas, 112 corridas, un agente por corrida, sin descartar
ninguna: todas las que se registraron están en la tabla, salvo las que reemplazó
una versión posterior del código en la misma tarea, que se guardan en
[`bench/results/archive/`](bench/results/archive). El detalle por tarea y los
datos crudos están en [Benchmark](#benchmark).

La cifra de arriba, entre un 13% y un 19%, cuenta solo las corridas que pasaron su verificación oculta. En Haiku 4.5 eso da −18,8% sobre las 7 tareas en las que ambas condiciones tienen una corrida aprobada, frente a −23,0% sobre las 8. Opus 5.5 y Sonnet 5 pasaron todas las corridas. En Haiku 4.5, las corridas con ThinWindow fallaron la verificación oculta más veces que las base: 3 de 16 frente a 2 de 16. IC 95%: bootstrap sobre las tareas. Donde incluye el cero, el cambio no se distingue de ninguno en este conjunto de tareas. Una corrida cortada por el tope de turnos terminó en el límite antes de que el agente acabara; sus tokens no son comparables con los de una corrida terminada.
<!-- RESULTS:END -->

## Por qué lo que se paga es el contexto

Un agente de código no paga sobre todo por lo que escribe. Paga por lo que
arrastra. Cada archivo que abre, cada log de instalación que imprime y cada grep
amplio que corre se agrega a la conversación, y la conversación entera se
reenvía en cada turno posterior. El costo de una sesión se parece más a

```
tokens ≈ tamaño del contexto × turnos
```

que al largo de la respuesta. En las corridas base medidas acá, **entre el 87% y
el 96% de los tokens facturados fueron lecturas de caché** — contexto reenviado,
turno tras turno — frente a entre el 0,6% y el 1,9% de la salida del propio agente:

<!-- CACHE:START -->
| Modelo | Proporción de | Lecturas de caché | Escrituras de caché | Salida |
| --- | --- | ---: | ---: | ---: |
| Opus 5.5 | tokens | 92,0% | 6,6% | 1,3% |
|  | costo | 18,8% | 54,3% | 26,9% |
| Sonnet 5 | tokens | 87,1% | 11,0% | 1,9% |
|  | costo | 21,6% | 54,4% | 24,0% |
| Haiku 4.5 | tokens | 96,4% | 2,9% | 0,6% |
|  | costo | 51,9% | 31,6% | 16,4% |
<!-- CACHE:END -->

Con precios, las mismas corridas se ven distintas (las filas de costo): una
lectura de caché cuesta una décima parte de un token de entrada o menos, una
escritura de caché el doble de uno, y la salida cinco veces uno. Pedirle al
agente que sea breve toca la columna de salida, que es chica en tokens pero no
en costo. Evitar que se traiga un archivo de 2.000 líneas al contexto en el
turno 3 toca las dos columnas de caché, en todos los turnos que siguen.

ThinWindow ataca los dos factores: achica lo que entra al contexto y evita los
turnos extra que se gastan lidiando con una salida que el agente nunca necesitó.
Cómo se reparte la factura por tipo de token, qué llama el agente y qué pasa
con las corridas que no terminan: [Where the tokens go](docs/WHERE-THE-TOKENS-GO.md)
(en inglés).

## Instalación

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

**Agentes que leen `AGENTS.md`**: pegá [`adapters/AGENTS.md`](adapters/AGENTS.md)
en el `AGENTS.md` de tu proyecto.

Lo apagás cuando quieras con `THINWINDOW=off`, o con `"enabled": false` en
`.thinwindow.json`.

## Cómo funciona

1. **Reglas** ([`rules/thinwindow.md`](rules/thinwindow.md), menos de 500 tokens)
   cargadas al inicio de la sesión: localizar antes de leer, leer por rangos, acotar
   la salida de los comandos, escribir el cambio más chico, cerrar con tres
   líneas como máximo.
2. **Hooks** (solo en Claude Code) que hacen cumplir la parte cara sin que el
   agente gaste un turno:
   - Un `Read` completo de un archivo de más de 400 líneas devuelve las primeras
     120 líneas más un índice numerado, para que la lectura siguiente apunte a un
     rango.
   - Se rechaza releer un archivo sin cambios que ya está en el contexto.
   - Instalaciones, builds, tests y linters pasan por `thinwindow-run`: el log
     completo va a un archivo temporal y el agente ve el código de salida, el
     final del log y las líneas de error.
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
  `.thinwindow.json`, en el proyecto y en tu carpeta de usuario; y las
  variables de entorno `THINWINDOW`, `THINWINDOW_DEBUG` y `CLAUDE_PROJECT_DIR`.
  No lee credenciales.
- **Escribe:** solo en el directorio temporal del sistema operativo: un JSON
  chico por sesión (qué archivos y rangos se leyeron, los rechazos recientes y
  el conteo de lo que hicieron los hooks) y el log completo de cada comando que
  pasa por `thinwindow-run`. Los dos se borran a los 7 días.
- **Envía:** nada. No tiene código de red.

## Benchmark

<!-- BENCH:START -->
Tres modelos, 8 tareas, 112 corridas. Los gráficos y las tablas los genera
[`bench/report.mjs`](bench/report.mjs) a partir de los archivos crudos.

### Opus 5.5

![Cambio en tokens totales por tarea, Opus 5.5: a la izquierda del cero, menos tokens con ThinWindow; los bigotes cubren cada par de corridas](bench/results/chart-claude-opus-5-5.svg)

### Sonnet 5

![Cambio en tokens totales por tarea, Sonnet 5: a la izquierda del cero, menos tokens con ThinWindow; los bigotes cubren cada par de corridas](bench/results/chart-claude-sonnet-5.svg)

### Haiku 4.5

![Cambio en tokens totales por tarea, Haiku 4.5: a la izquierda del cero, menos tokens con ThinWindow; los bigotes cubren cada par de corridas](bench/results/chart-claude-haiku-4-5.svg)
<!-- BENCH:END -->

Las tablas por tarea, con la dispersión y la tasa de éxito, están en
[`bench/results/report.md`](bench/results/report.md) y en la
[sección Benchmark del README en inglés](README.md#benchmark) (se generan en
inglés, así que no las duplico acá y quedan siempre al día). Las corridas
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

Las corridas son secuenciales, de a una, así nunca compiten por los límites de
uso. El costo es el precio equivalente de API que informa Claude Code; con una
suscripción se paga en límites de uso, pero la proporción es la misma.

### Comprobalo en vez de creerme

- Cada corrida es una línea de JSONL en [`bench/results/`](bench/results), con
  el modelo, la versión de Claude Code, el commit de ThinWindow, los conteos de
  tokens crudos y la traza de herramientas. Ningún número de este README está
  escrito a mano.
- Una tarea se volvió a medir después de un arreglo. En Sonnet 5, todas las
  corridas con ThinWindow de commander-ci-config cortaron
  `cat .github/workflows/*.yml` a 60 líneas y perdieron el archivo que pide la
  tarea; ahora el hook deja enteras las concatenaciones cortas
  ([#7](https://github.com/thinwindow/thinwindow/issues/7)). Las tres corridas
  con ThinWindow de esa tarea se repitieron en 30e9c6b (+29,3% → +3,9%), y las
  tres que reemplazan están en [`bench/results/archive/`](bench/results/archive).
  Ninguna otra corrida registrada hace esa llamada, así que no se repitió ninguna
  otra tarea.
- Las reglas se ajustaron sobre esas mismas 8 tareas, en dos bibliotecas de
  parseo de argumentos de línea de comandos, en JavaScript y Python. Es una
  porción acotada del software que existe. Tu ahorro en otro trabajo va a ser
  distinto.
- Las muestras son chicas. Los agentes varían mucho: la misma tarea tomó 4
  turnos en una corrida y 9 en la siguiente (commander-extract-utils en Sonnet 5,
  sin ThinWindow), por eso las tablas muestran medianas y el rango por tarea, y
  no un único promedio de titular.
- Correlo contra tu propia cuenta y tus propios límites:

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

- **No todas las tareas mejoran.** En Sonnet 5, tres de las ocho tareas todavía
  salen más caras con ThinWindow que sin él. Solo con neutralizar esas
  regresiones —sin ahorrar un token más en ningún otro lado— Sonnet pasaría de
  −13,2% a cerca de −17,5%, y Opus de −15,8% a cerca de −17,7%. El margen de
  corto plazo está más en no empeorar las tareas cortas que en exprimir las
  largas. Lo que muestran las trazas de cada una está en
  [#7](https://github.com/thinwindow/thinwindow/issues/7).
- **Los turnos son el factor todavía sin aprovechar.** Como el costo es aproximadamente
  contexto × turnos, un turno ahorrado vale tanto como una lectura grande
  evitada. Opus usó un 12,9% menos de turnos acá y recortó el costo un 19,4%;
  Sonnet usó los mismos turnos que sin ThinWindow y recortó el costo un 7,9%.
  Un intento previo de reglas explícitas de "usá menos turnos" empeoró los
  resultados de Sonnet de forma medible y se revirtió, en lugar de mantenerse y
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
| Opus 5.5 | 106 | 52 | 2 | 83.853 → 84.720 | +1,0% |
| Sonnet 5 | 134 | 66 | 3 | 114.982 → 115.879 | +0,8% |
| Haiku 4.5 | 366 | 250 | 41 | 861.988 → 524.951 | −39,1% |

Sin repetir: 183 llamadas que la traza cortó (guarda 140 caracteres de cada una), 33 que escriben archivos, corren un script o cambian el repositorio, y 22 cuyo archivo no se pudo identificar.

El cambio en la factura es otra magnitud, medida en [Benchmark](#benchmark), y no del mismo tamaño:
- Opus 5.5: los hooks cambian 2 de 106 llamadas y agrandan la salida repetida un 1,0%; en el benchmark actuaron en 1 de 16 corridas con ThinWindow, y el cambio medido en el costo es −19,4% (IC 95% −26,2% a −10,2%).
- Sonnet 5: los hooks cambian 3 de 134 llamadas y agrandan la salida repetida un 0,8%; en el benchmark actuaron en 3 de 24 corridas con ThinWindow, y el cambio medido en el costo es −7,9% (IC 95% −18,4% a +2,5%).
- Haiku 4.5: los hooks cambian 41 de 366 llamadas y recortan la salida repetida un 39,1%; en el benchmark actuaron en 9 de 16 corridas con ThinWindow, y el cambio medido en el costo es −20,2% (IC 95% −30,5% a −10,9%).

Donde los hooks casi no actúan, el cambio medido viene de las reglas, que cambian lo que hace el agente, o del ruido entre corridas, no de recortar la salida de las herramientas.
<!-- TIER1:END -->

## Contribuir

Este es justo el tipo de proyecto que mejora con las cargas de trabajo de otras
personas, porque los límites de arriba son los límites de la muestra de *una sola
persona*.

Lo más útil, más o menos en orden:

1. **Resultados de benchmark con tu propio stack.** Una tarea nueva en
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

Esto empezó como una herramienta personal. La hice para abaratar mi propio flujo
de trabajo, y la publiqué porque las mediciones pueden servirle a alguien más,
no porque sea un producto terminado con un contrato de soporte detrás.

Leé los números con eso en mente:

- **El benchmark es acotado y lo elegí yo.** Ocho tareas, dos repositorios, tres
  modelos, unas pocas repeticiones cada uno, todo elegido por mí, con reglas
  ajustadas contra esas mismas tareas. Alcanza para mostrar una dirección; no
  alcanza para prometerte un porcentaje. Está publicado completo, con los
  archivos crudos, justamente para que juzgues vos cuánto se generaliza en vez
  de creerle a un número de titular.
- **La contabilidad de tokens es volátil por naturaleza.** Lo que termina en una
  ventana de contexto depende de la versión del modelo, del entorno de ejecución del
  agente y su prompt de sistema, de la tasa de aciertos de caché, de qué herramientas
  están habilitadas, de los servidores MCP, del tamaño del repositorio y de cómo
  se desarrolle la tarea ese día. Cualquiera de esos factores puede mover el
  resultado más que el efecto medido acá. Dos corridas idénticas de la misma
  tarea pueden diferir bastante; las medianas y los rangos de las tablas están
  para que eso se vea, no para taparlo.
- **Los resultados envejecen.** Se midieron con una versión concreta de Claude
  Code y con snapshots concretos de los modelos, y las dos cosas cambian
  seguido. Se van a volver a medir en lugar de quedar publicados sin revisión.
- **Sin garantía.** Este software se entrega "tal cual" bajo la
  [licencia MIT](LICENSE), sin garantía de ningún tipo. Vos sos responsable de
  lo que corre en tu entorno y de lo que gastás. Los hooks están diseñados para
  fallar en modo abierto y nunca bloquear una llamada, y los tests cubren ese
  comportamiento, pero ninguna cantidad de tests es una garantía: revisá el
  código, corré los tests y probalo en una rama antes de confiarle trabajo real.
- **No reemplaza un buen prompt.** Elimina desperdicio; no hace más inteligente al
  agente.

## Preguntas frecuentes

**¿Hace que mi agente rinda peor?** Para eso está la columna de éxito en
cada tabla. Un ahorro que hace fallar la tarea no es un ahorro. En los tres
modelos el éxito fue idéntico a la baseline salvo en una tarea de Haiku,
commander-rename-display-width: 1/2 sin ThinWindow, 0/2 con él. A Haiku le
cuesta esa tarea de cualquier forma: fallaron tres de sus cuatro corridas, y
todas tomaron 35 turnos o más.

**¿Por qué no pedirle al agente que sea breve?** Ayuda, y las reglas lo piden:
la salida es apenas entre el 0,6% y el 1,9% de los tokens, pero a cinco veces
el precio de la entrada es entre el 16% y el 27% del costo (ver [Por qué lo que
se paga es el contexto](#por-qué-lo-que-se-paga-es-el-contexto)). El resto es
contexto: una respuesta larga se paga una vez, mientras que una lectura larga se
escribe en la caché una vez y se vuelve a leer en cada turno que sigue.

**¿Manda mi código o telemetría a algún lado?** No. En este proyecto no hay
código de red: sin analíticas, sin reportes de error, sin "estadísticas anónimas
de uso", sin chequeo de licencia ni de actualizaciones. Los hooks son scripts
locales de Node que leen la llamada a la herramienta y devuelven una decisión;
los logs recortados van a un archivo temporal en tu propio disco. Lo único que
sale de tu máquina es lo que tu agente ya le estaba mandando a tu proveedor de
modelos, y el sentido de esta herramienta es que eso sea más chico.

**¿Funciona fuera de Claude Code?** Las reglas sí, vía Agent Skills o
`AGENTS.md`. Los hooks —que hacen el trabajo pesado— son solo de Claude Code,
porque dependen de su API de hooks sobre llamadas a herramientas.

## Licencia

MIT
