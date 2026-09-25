# thinwindow

[English](README.md) · **Español** · [Português](README.pt-BR.md)

**Que los agentes de código lean menos.** Menos tokens por tarea, los mismos
resultados y un benchmark que podés volver a correr vos.

| Modelo | Tokens | Costo | Éxito base → thinwindow | Corridas |
| --- | ---: | ---: | :---: | ---: |
| Haiku 4.5 | **−23,0%** | **−20,2%** | **14/16** → **13/16** | 32 |
| Sonnet 5 | **−11,6%** | **−7,4%** | **24/24** → **24/24** | 48 |
| Opus 5.5 | **−15,8%** | **−19,4%** | **16/16** → **16/16** | 32 |

Las mismas 8 tareas, 112 corridas, un agente por corrida. El detalle por tarea,
la dispersión y los datos crudos están en [Benchmark](#benchmark).

Casi todo lo que paga un agente de código es entrada, no salida: leer archivos
enteros, logs de instalación y de tests, greps amplios. Todo lo que lee queda en
el contexto y se reenvía en cada turno posterior, así que una lectura temprana
de 2.000 líneas se vuelve a pagar en todos los turnos que siguen. thinwindow
corta eso en la fuente, y de paso recorta lo que el agente escribe y comenta.

## Instalación

**Claude Code** (reglas + hooks, la versión completa):

```
/plugin marketplace add imprvhub/thinwindow
/plugin install thinwindow@thinwindow
```

**Cualquier agente con Agent Skills** (Codex, Cursor, Copilot, Gemini CLI,
OpenCode...), solo las reglas:

```
npx skills add imprvhub/thinwindow
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

Sin dependencias, sin telemetría, Node 18+. Detalles y todas las opciones:
[docs/configuration.md](docs/configuration.md).

## Benchmark

Tres modelos, 112 corridas. Las tablas por tarea las genera
[`bench/report.mjs`](bench/report.mjs) a partir de los archivos crudos; nada está
escrito a mano.

- **Tablas detalladas por tarea** (en inglés, generadas):
  [`bench/results/report.md`](bench/results/report.md) o la sección
  [Benchmark del README en inglés](README.md#benchmark).
- **Corridas crudas**, una línea por corrida:
  [`haiku-528598a.jsonl`](bench/results/haiku-528598a.jsonl) ·
  [`sonnet-528598a.jsonl`](bench/results/sonnet-528598a.jsonl) ·
  [`opus-528598a.jsonl`](bench/results/opus-528598a.jsonl)
- **Gráficos**: [Haiku](bench/results/chart-claude-haiku-4-5.svg) ·
  [Sonnet](bench/results/chart-claude-sonnet-5.svg) ·
  [Opus](bench/results/chart-claude-opus-5-5.svg)

El ahorro depende mucho de la tarea: las que exigen leer mucho son las que más
bajan (por ejemplo `click-help-spec` en Sonnet: −55,3%), y alguna tarea corta
sale levemente peor. La salida baja en los tres modelos.

### Cómo se mide

Cada **corrida** es un agente resolviendo una tarea desde cero:

1. Clonar un repo real de código abierto ([click](https://github.com/pallets/click)
   o [commander.js](https://github.com/tj/commander.js)) en un commit fijo, dentro
   de un directorio temporal nuevo.
2. Instalar sus dependencias antes de que arranque el agente, para que los logs
   de instalación no cuenten para ningún lado.
3. Correr `claude -p "<tarea>"` con el modelo elegido, hasta 40 turnos. La
   *baseline* usa Claude Code pelado; *thinwindow* usa lo mismo más este plugin.
   No cambia nada más: sin servidores MCP, sin configuración de usuario.
4. Correr la verificación oculta de la tarea (un test o un script que el agente
   nunca ve). Código de salida 0 es éxito.
5. Registrar tokens (entrada, escrituras y lecturas de caché, salida, subagentes
   incluidos), costo, turnos y tiempo desde el JSON que devuelve Claude Code.

Las 8 tareas son la mezcla de todos los días: arreglos de bugs con un test que
falla, una función chica, un rename entre archivos, un refactor, una búsqueda de
configuración y "que el año del copyright del pie de página se actualice solo".
Los archivos de las tareas están en [`bench/tasks/`](bench/tasks).

Las corridas son secuenciales, de a una, así nunca compiten por los límites de
uso. El costo es el precio equivalente de API que informa Claude Code; con una
suscripción se paga en límites de uso, pero la proporción es la misma.

**Desconfiá, y comprobá:**

- Cada corrida es una línea en un archivo JSONL de
  [`bench/results/`](bench/results), con el modelo, la versión de Claude Code, el
  commit de thinwindow y los conteos de tokens crudos.
- Las reglas se ajustaron sobre estas mismas 8 tareas. Tu ahorro en otro trabajo
  puede ser menor o mayor.
- Las muestras son chicas. Los agentes son ruidosos: la misma tarea puede tomar 4
  turnos una vez y 15 la siguiente, por eso las tablas muestran medianas y el
  rango por tarea.
- Correlo vos mismo (usa tu propia sesión de Claude Code y tus límites):

  ```
  node bench/run.mjs --condition baseline,thinwindow --reps 3 --model sonnet --dry-run
  node bench/run.mjs --condition baseline,thinwindow --reps 3 --model sonnet --max-cost 10
  node bench/report.mjs
  ```

  Todas las opciones están en [bench/README.md](bench/README.md).

## Preguntas frecuentes

**¿Deja más tonto a mi agente?** La tasa de éxito de cada tabla mide justamente
eso. Un ahorro que hace fallar la tarea no cuenta como ahorro.

**¿Por qué no le digo al agente que sea breve y listo?** La salida es la parte
barata. Una respuesta larga se paga una vez; una lectura larga se vuelve a pagar
en cada turno que sigue. thinwindow también recorta la salida, pero la mayor
parte del ahorro está del lado de la entrada.

**¿Manda datos a algún lado?** No. Nada sale de tu máquina.

## Licencia

MIT
