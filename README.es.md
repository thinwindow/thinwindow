<p align="center">
  <img src="assets/icon.iconset/icon_128x128@2x.png" alt="Logo de ThinWindow" width="112" height="112">
</p>

<h1 align="center">ThinWindow</h1>

<p align="center">
  <strong>Que los agentes de código lean menos.</strong><br>
  Menos tokens por tarea, los mismos resultados y un benchmark que podés volver a correr vos.
</p>

<p align="center">
  <a href="README.md">English</a> · <b>Español</b> · <a href="README.pt-BR.md">Português</a>
</p>

| Modelo | Tokens | Costo | Éxito base → ThinWindow | Corridas |
| --- | ---: | ---: | :---: | ---: |
| Opus 5.5 | **−15,8%** | **−19,4%** | **16/16** → **16/16** | 32 |
| Sonnet 5 | **−11,6%** | **−7,4%** | **24/24** → **24/24** | 48 |
| Haiku 4.5 | **−23,0%** | **−20,2%** | **14/16** → **13/16** | 32 |

Las mismas 8 tareas, 112 corridas, un agente por corrida, sin descartar
ninguna: todas las que se registraron están en la tabla. El detalle por tarea y
los datos crudos están en [Benchmark](#benchmark).

## Por qué el contexto es la cuenta

Un agente de código no paga sobre todo por lo que escribe. Paga por lo que
arrastra. Cada archivo que abre, cada log de instalación que imprime y cada grep
amplio que corre se agrega a la conversación, y la conversación entera se
reenvía en cada turno posterior. El costo de una sesión se parece más a

```
tokens ≈ tamaño del contexto × turnos
```

que al largo de la respuesta. En las corridas medidas acá, **entre el 87% y el
96% de los tokens facturados fueron lecturas de caché** — contexto reenviado,
turno tras turno — contra 0,6% a 1,9% de la salida del propio agente:

| Modelo | Lecturas de caché | Escrituras de caché | Salida |
| --- | ---: | ---: | ---: |
| Opus 5.5 | 92,0% | 6,6% | 1,3% |
| Sonnet 5 | 87,1% | 11,0% | 1,9% |
| Haiku 4.5 | 96,4% | 2,9% | 0,6% |

Esa es toda la tesis. Pedirle al agente que sea breve toca la columna del ~1%.
Evitar que se traiga un archivo de 2.000 líneas al contexto en el turno 3 toca
la del ~90%, en todos los turnos que siguen.

ThinWindow ataca los dos factores: achica lo que entra al contexto y evita los
turnos extra que se gastan lidiando con salida que el agente nunca necesitó.

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
   cargadas al inicio de la sesión: ubicar antes de leer, leer por rangos, acotar
   la salida de los comandos, escribir el cambio más chico, cerrar con tres
   líneas como máximo.
2. **Hooks** (solo Claude Code) que aplican la parte cara, sin gastarle un turno
   al agente:
   - Un `Read` completo de un archivo de más de 400 líneas devuelve las primeras
     120 líneas más un índice numerado, para que la lectura siguiente apunte a un
     rango.
   - Releer un archivo sin cambios que ya está en contexto se rechaza.
   - Instalaciones, builds, tests y linters pasan por `thinwindow-run`: el log
     completo va a un archivo temporal y el agente ve el código de salida, el
     final del log y las líneas de error.
   - `cat` de archivos enormes, lockfiles o archivos minificados, `git log` sin
     `-n`, `ls -R`, `tree` sin `-L` y `find` sin límite reciben un reemplazo más
     barato. El `Grep` por contenido recibe `head_limit: 100`.
3. **Falla abierto.** Cualquier error de un hook deja pasar la llamada. Repetir
   una llamada rechazada también pasa, así el agente nunca queda trabado.

Las reglas las aplican los hooks en vez de confiar en el modelo, porque una
regla que el agente puede olvidar bajo presión no es una regla. Los hooks corren
sobre la llamada a la herramienta, antes de que el resultado llegue al contexto,
así que aplicarlas no cuesta un turno.

Sin dependencias, sin telemetría, Node 18+. Detalles y todas las opciones:
[docs/configuration.md](docs/configuration.md).

## Benchmark

Tres modelos, 8 tareas, 112 corridas. Los gráficos y las tablas los genera
[`bench/report.mjs`](bench/report.mjs) a partir de los archivos crudos.

### Opus 5.5

![Cambio en tokens totales por tarea, Opus 5.5: las barras a la izquierda del cero son tokens ahorrados](bench/results/chart-claude-opus-5-5.svg)

### Sonnet 5

![Cambio en tokens totales por tarea, Sonnet 5: las barras a la izquierda del cero son tokens ahorrados](bench/results/chart-claude-sonnet-5.svg)

### Haiku 4.5

![Cambio en tokens totales por tarea, Haiku 4.5: las barras a la izquierda del cero son tokens ahorrados](bench/results/chart-claude-haiku-4-5.svg)

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
   de instalación no se le facturen a ningún lado.
3. Correr `claude -p "<tarea>"` con el modelo elegido, con un tope de 40 turnos.
   La *baseline* usa Claude Code pelado; *ThinWindow* usa lo mismo más este
   plugin. No cambia nada más: sin servidores MCP, sin configuración de usuario,
   sin memoria entre corridas.
4. Correr la verificación oculta de la tarea: un test o un script que el agente
   nunca ve. Código de salida 0 es éxito.
5. Registrar tokens (entrada, escrituras y lecturas de caché, salida,
   subagentes incluidos), costo, turnos y tiempo desde el JSON que devuelve
   Claude Code, más la traza completa de llamadas a herramientas.

Las 8 tareas son la mezcla de todos los días: arreglos de bugs con un test que
falla, una función chica, un rename entre archivos, un refactor, una búsqueda de
configuración y "que el año del copyright del pie de página se actualice solo".
Las definiciones están en [`bench/tasks/`](bench/tasks).

Las corridas son secuenciales, de a una, así nunca compiten por los límites de
uso. El costo es el precio equivalente de API que informa Claude Code; con una
suscripción se paga en límites de uso, pero la proporción es la misma.

### Comprobalo en vez de creerme

- Cada corrida es una línea de JSONL en [`bench/results/`](bench/results), con
  el modelo, la versión de Claude Code, el commit de ThinWindow, los conteos de
  tokens crudos y la traza de herramientas. Ningún número de este README está
  escrito a mano.
- Las reglas se ajustaron sobre esas mismas 8 tareas, en dos librerías de
  parseo de argumentos de línea de comandos, en JavaScript y Python. Es una
  porción angosta del software que existe. Tu ahorro en otro trabajo va a ser
  distinto.
- Las muestras son chicas. Los agentes son ruidosos: la misma tarea puede tomar
  4 turnos una vez y 15 la siguiente, por eso las tablas muestran medianas y el
  rango por tarea, y no un único promedio de portada.
- Corrélo contra tu propia cuenta y tus propios límites:

  ```
  node bench/run.mjs --condition baseline,ThinWindow --reps 3 --model sonnet --dry-run
  node bench/run.mjs --condition baseline,ThinWindow --reps 3 --model sonnet --max-cost 10
  node bench/report.mjs
  ```

  Todas las opciones están en [bench/README.md](bench/README.md).

### Dónde queda margen

Estos números son una medición actual, no un techo. Se van a mover a medida que
cambien las reglas, los modelos y el propio Claude Code, y la idea es seguir
mejorándolos y volver a publicar los archivos crudos cada vez.

En los datos se ven dos cosas:

- **No todas las tareas mejoran.** En Sonnet 5, tres de las ocho tareas salen
  más caras con ThinWindow que sin él. Solo con neutralizar esas regresiones
  —sin ahorrar un token más en ningún otro lado— Sonnet pasaría de −11,6% a
  cerca de −17,5%, y Opus de −15,8% a cerca de −17,7%. El margen de corto plazo
  está más en no empeorar las tareas cortas que en exprimir las largas.
- **Los turnos son el factor sin explotar.** Como el costo es aproximadamente
  contexto × turnos, un turno ahorrado vale tanto como una lectura grande
  evitada. Opus usó 12,9% menos turnos acá y muestra el mayor recorte de costo;
  Sonnet usó 1,6% más y muestra el menor. Un intento previo de reglas
  explícitas de "usá menos turnos" empeoró a Sonnet de forma medible y se
  revirtió, en vez de quedarse y excluirse en silencio: ese experimento
  revertido sigue en el historial.

## Contribuir

Este es justo el tipo de proyecto que mejora con la carga de trabajo de otra
gente, porque los límites de arriba son los límites de la muestra de *una sola
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
   suenen; además el archivo de reglas tiene un presupuesto de tokens que CI
   hace cumplir.

El flujo está en [CONTRIBUTING.md](CONTRIBUTING.md).

## Alcance, limitaciones y descargo

Esto empezó como una herramienta personal. La hice para abaratar mi propio flujo
de trabajo, y la publiqué porque las mediciones pueden servirle a alguien más,
no porque sea un producto terminado con un contrato de soporte detrás.

Leé los números con eso en mente:

- **El benchmark es angosto y lo elegí yo.** Ocho tareas, dos repositorios, tres
  modelos, unas pocas repeticiones cada uno, todo elegido por mí, con reglas
  ajustadas contra esas mismas tareas. Alcanza para mostrar una dirección; no
  alcanza para prometerte un porcentaje. Está publicado completo, con los
  archivos crudos, justamente para que juzgues vos qué tanto generaliza en vez
  de creerle a un número de portada.
- **La contabilidad de tokens es volátil por naturaleza.** Lo que termina en una
  ventana de contexto depende de la versión del modelo, del arnés del agente y
  su prompt de sistema, de la tasa de aciertos de caché, de qué herramientas
  están habilitadas, de los servidores MCP, del tamaño del repositorio y de cómo
  se desarrolle la tarea ese día. Cualquiera de esos factores puede mover el
  resultado más que el efecto medido acá. Dos corridas idénticas de la misma
  tarea pueden diferir bastante; las medianas y los rangos de las tablas están
  para que eso se vea, no para taparlo.
- **Los resultados envejecen.** Se midieron con una versión concreta de Claude
  Code y con snapshots concretos de los modelos, y las dos cosas cambian
  seguido. Se van a volver a medir en vez de quedar ahí sin aviso.
- **Sin garantía.** Este software se entrega "tal cual" bajo la
  [licencia MIT](LICENSE), sin garantía de ningún tipo. Vos sos responsable de
  lo que corre en tu entorno y de lo que gastás. Los hooks están diseñados para
  fallar abiertos y nunca bloquear una llamada, y los tests cubren ese
  comportamiento, pero ninguna cantidad de tests es una garantía: revisá el
  código, corré los tests y probalo en una rama antes de confiarle trabajo real.
- **No reemplaza un buen prompt.** Saca desperdicio; no hace más inteligente al
  agente.

## Preguntas frecuentes

**¿Deja peor a mi agente en la tarea?** Para eso está la columna de éxito en
cada tabla. Un ahorro que hace fallar la tarea no es un ahorro. En los tres
modelos el éxito fue idéntico a la baseline salvo por una sola corrida de Haiku,
donde las dos condiciones ya estaban pegando contra el tope de 40 turnos.

**¿Por qué no le digo al agente que sea breve y listo?** Porque la salida es
cerca del 1% de la cuenta, como muestra la tabla del principio. Una respuesta
larga se paga una vez; una lectura larga se vuelve a pagar en cada turno que
sigue. ThinWindow también recorta la salida, pero esa es la mitad chica del
problema.

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
