<div align="center">

![Logo de ThinWindow](assets/icon.iconset/icon_128x128.png)

</div>

<h1 align="center">ThinWindow</h1>

<p align="center">
  <strong>Menos en la ventana. No lo pagues dos veces.</strong><br>
  ThinWindow mantiene delgada la ventana de contexto de Claude Code desde el primer prompt hasta la mañana siguiente. Recorta las lecturas y los logs desmedidos mientras trabajas, muestra lo que carga cada solicitud y, cuando vuelves a una sesión vencida, ofrece empezar de cero desde un resumen breve en lugar de pagar otra vez el contexto viejo.<br>
  Listado en el directorio oficial de plugins de Claude Code.
</p>

<p align="center">
  <a href="#instalación"><b>Instalación</b></a> · <a href="#qué-hace-thinwindow">Qué hace</a> · <a href="#dónde-funciona">Dónde funciona</a> · <a href="#qué-lee-escribe-y-envía">Privacidad</a> · <a href="https://thinwindow.github.io/thinwindow/">Sitio de documentación</a> (en inglés)
</p>

<p align="center">
  <a href="README.md">English</a> · <b>Español</b> · <a href="README.pt-BR.md">Português</a>
</p>

## Por qué lo que se paga es el contexto

Un agente de código paga más por lo que arrastra que por lo que escribe.

- **Cada solicitud reenvía la sesión entera.** Cada archivo que Claude lee,
  cada log que imprime y cada respuesta larga queda en la conversación, y se
  vuelve a pagar, desde la caché de prompts, en cada solicitud posterior.
- **Una sesión vencida se paga dos veces.** Claude Code guarda la caché de
  prompts de una sesión hasta una hora. Si vuelves más tarde, tu siguiente
  prompt escribe otra vez todo el contexto al precio de escritura de caché,
  muchas veces lo que cuesta leerlo desde la caché.
- **Tu configuración viaja en cada solicitud.** El prompt de sistema, las
  definiciones de herramientas, los listados de skills y de agentes, las
  instrucciones de MCP y los archivos CLAUDE.md salen con cada una.

ThinWindow trabaja sobre las tres cosas, en los cuatro momentos de una sesión.

## Qué hace ThinWindow

### Al empezar: saber qué carga cada solicitud

**El aviso de costo de configuración.** Una vez por semana y por proyecto,
cuando la primera solicitud de una sesión es de 40k tokens o más, ThinWindow
te muestra una línea: con cuánto arranca cada solicitud de esa sesión y sus
partes más grandes. Ejemplo:

```
ThinWindow: each request in this session starts at 54k tokens (skill listing 5.3k, deferred tools 2.5k, MCP instructions 1.6k). Run /context to see what you could turn off.
```

Se te muestra a ti y nunca se envía a Claude. En la app de escritorio aparece
como un "Claude Code notice" plegado.

**`thinwindow-minimal`, un perfil opcional para sesiones de código
enfocadas.** Un archivo que copias. Conserva el prompt de sistema propio de
Claude Code y tus herramientas de MCP, y quita las herramientas integradas que
las sesiones del autor casi nunca usaron:

- subagentes y equipos de agentes;
- `/loop`, las tareas programadas, los disparadores remotos y las
  notificaciones push;
- las herramientas de tareas en segundo plano (los comandos de Bash en segundo
  plano siguen funcionando);
- volver a leer la lista de tareas (crear y actualizar tareas sigue
  funcionando);
- los worktrees, los notebooks y las preguntas de opción múltiple;
- el modo plan activado por Claude (Shift+Tab sigue funcionando);
- la herramienta Skill y, con ella, el listado de skills (las skills que
  escribes, como `/thinwindow:report`, siguen funcionando);
- en la app de escritorio: los artifacts, la sincronización de diseño, las
  tarjetas de archivos, el feedback y los hallazgos de revisión.

```bash
curl -fsSL --create-dirs -o ~/.claude/agents/thinwindow-minimal.md https://raw.githubusercontent.com/thinwindow/thinwindow/main/profiles/thinwindow-minimal.md
claude --agent thinwindow-minimal
```

O, para todas las sesiones de un proyecto, `"agent": "thinwindow-minimal"` en
el `.claude/settings.json` de ese proyecto. ThinWindow nunca lo activa por ti.

- **No lo uses cuando** quieras subagentes, `/loop`, tareas programadas o
  skills que Claude inicie por su cuenta.
- **Mientras el archivo esté en `~/.claude/agents/`,** las sesiones que no lo
  usan lo listan entre tus subagentes, con una línea que incluye su lista de
  herramientas. Borra el archivo para quitarlo.
- **La copia no se actualiza sola** cuando Claude Code agrega herramientas. La
  lista exacta está en [el archivo](profiles/thinwindow-minimal.md).

### Mientras trabajas: mantener delgada la ventana

**Las reglas.** Al iniciar la sesión, ThinWindow agrega al contexto de Claude
un conjunto breve de reglas: ubicar antes de leer y leer solo el rango que
hace falta; acotar la salida de los comandos; comprobar que el código hace
falta antes de escribirlo y hacer el cambio más pequeño; no narrar entre
llamadas a herramientas y terminar con tres líneas como máximo. Se mantienen
por debajo de 2.000 caracteres, y CI lo comprueba:
[`rules/thinwindow.md`](rules/thinwindow.md).

**Los controles.** Hooks que actúan sobre la propia llamada a la herramienta,
antes de que su resultado entre al contexto, así que aplicarlos no cuesta un
turno.

- **Control de Read:**
  - leer entero un archivo de más de 400 líneas devuelve sus primeras 120
    líneas y un índice con números de línea, para que la siguiente lectura
    apunte a un rango;
  - volver a leer un archivo sin cambios que ya está en el contexto se
    rechaza.
- **Control de Bash:**
  - las instalaciones, los builds, los tests y los linters pasan por
    `thinwindow-run`;
  - las búsquedas recursivas sin límite se acotan, y un `git diff` a secas
    corre como `git diff --stat`;
  - `cat` de un lockfile o de un archivo enorme, `git log` sin límite,
    `ls -R`, `tree` sin `-L` y un `find` sin límite se rechazan, con un comando
    más barato para correr en su lugar.
- **Tope de Grep:** una búsqueda de contenido sin límite recibe uno de 100
  líneas.

**`thinwindow-run`.** Corre un comando ruidoso, guarda el log completo en un
archivo temporal y le muestra a Claude el código de salida, el final y las
líneas de error. Una salida corta vuelve tal cual.

**Falla abierto.**

- Si un control falla, la llamada sigue adelante.
- Repetir una lectura o un comando ruidoso rechazados también lo deja pasar, y
  los pocos comandos que siempre se rechazan traen uno que funciona. Claude no
  puede quedar atascado.
- ThinWindow nunca aprueba una llamada por la que tu configuración de permisos
  preguntaría.

### Entre sesiones: retomar sin pagar dos veces

**El resumen.** Al final de cada turno, ThinWindow mantiene al día un resumen
breve de la sesión, sin llamar a un modelo. Guarda:

- el objetivo;
- tus últimos pedidos;
- los archivos cambiados;
- los últimos comandos, con sus códigos de salida;
- la última respuesta de Claude.

Una sesión que nunca usa el resumen no suma ningún token por él.

**El aviso de sesión vencida.** Envías un prompt a una sesión que lleva más de
una hora inactiva y tiene al menos 100k tokens de contexto. ThinWindow retiene
el prompt una vez y muestra lo que reescribe seguir, en tokens y en US$ al
precio de lista del modelo, junto a empezar de cero. Ejemplo:

```
ThinWindow held this message: this session has been idle 9 h, so its prompt cache has expired.
Continuing re-writes ~427k tokens (~US$3.42 at Opus 5.5 list price): send it again.
A fresh start from a short brief re-writes ~55k tokens (~US$0.44): /clear, then /thinwindow:resume <your request>.
```

- **Decides tú cada vez:** vuelve a enviar el prompt para seguir.
- **Nunca se retienen:** los comandos, ni los prompts en sesiones `-p`, del
  SDK o en segundo plano.
- **En la app de escritorio,** el aviso es una tarjeta "A hook blocked your
  prompt", con "Edit prompt" para volver a enviarlo.

**`/thinwindow:resume`.** Después de `/clear`, arranca la sesión nueva desde
el resumen más reciente de este proyecto, de hasta 48 horas. Puedes agregar
tu siguiente pedido después del comando. El resumen:

- tiene 600 caracteres como máximo;
- va marcado como referencia, para que Claude lo contraste con `git status`;
- trae su antigüedad, los commits hechos desde entonces y la ruta del resumen
  completo.

**`/thinwindow:brief`.** Antes de irte, Claude escribe una entrega de cinco
líneas mientras la caché sigue caliente: qué está hecho, dónde se detuvo, las
decisiones, qué no funcionó y el siguiente paso. ThinWindow la guarda en el
resumen.

**El diálogo propio de Claude Code, "Resume from summary",** aparece cuando
haces `--resume` de una sesión grande después de alrededor de una hora (planes
Pro y Max). ThinWindow además cubre las sesiones que dejaste abiertas, muestra
lo que cuesta seguir antes de pagarlo y guarda un resumen para cualquier
`/clear` posterior.

### Después: ver adónde fue tu contexto

**`/thinwindow:report`.** Lee las transcripciones de tus propias sesiones de
Claude Code en esta máquina y muestra, en una pantalla:

- cuánto contexto reenvía cada solicitud, en promedio y en tus sesiones más
  largas;
- cuántas veces se reescribió una sesión después de que venció su caché, con
  qué tamaño y cuánto costaron esas reescrituras a precio de lista;
- qué carga la primera solicitud de una sesión, y sus partes más grandes;
- qué salida de herramientas se reenvía más (Bash, Read, herramientas de
  MCP…), y de qué tamaños;
- qué hizo ThinWindow en los últimos 7 días.

Los montos son lo que está en juego en tus propias sesiones, no lo que
ThinWindow ahorró. Con una suscripción, lee los US$ como un tamaño relativo.

## Instalación

**Desde el directorio de plugins:** en la app de escritorio de Claude,
Customize → Plugins → Discover → ThinWindow; en Claude Code, `/plugin` →
Discover → ThinWindow, o:

```
claude plugin install thinwindow@anthropic-plugin-directory
```

**Desde este repositorio**, en Claude Code:

```
/plugin marketplace add thinwindow/thinwindow
/plugin install thinwindow@thinwindow
```

**Cualquier agente con Agent Skills** (Codex, Cursor, Copilot, Gemini CLI,
OpenCode…). Recibe las reglas, `thinwindow-run` y el script del reporte:

```
npx skills add thinwindow/thinwindow
```

**Agentes que leen `AGENTS.md`:** pega [`adapters/AGENTS.md`](adapters/AGENTS.md)
en el `AGENTS.md` de tu proyecto.

ThinWindow se desactiva en cualquier momento con `THINWINDOW=off`, o con
`"enabled": false` en `.thinwindow.json`. Necesita Node.js 18 o más reciente,
y nada más.

## Dónde funciona

| Dónde | Qué hace ThinWindow ahí |
| --- | --- |
| Claude Code (terminal, IDE, la pestaña Code de la app de escritorio) | Todo: las reglas, los controles, el resumen, el aviso de sesión vencida, el aviso de costo de configuración y los comandos `/thinwindow:`. El perfil `thinwindow-minimal` funciona desde la terminal. |
| Cowork | Funcionan las reglas, el control de Read y `/thinwindow:brief`. `/thinwindow:report` cubre solo la tarea actual, los resúmenes no pasan de una tarea a otra y ninguno de los dos avisos se muestra. |
| Chat (claude.ai, las apps de escritorio y móviles) | Solo la Agent Skill: Claude carga las reglas cuando decide que una tarea las necesita, y `/thinwindow:brief` funciona. Los demás comandos necesitan una shell, que el chat no ejecuta. |

La validación de ThinWindow se corrió en Claude Code. En Cowork y en el chat se
comprobó qué funciona, sin medir.

## Mira tus propias sesiones

Instala ThinWindow, trabaja como siempre unos días y escribe
`/thinwindow:report`. Te muestra adónde fue el contexto de tus sesiones,
medido sobre tu propio trabajo en lugar de un benchmark.

- **`/thinwindow:report --json`** imprime un resumen breve sin montos en US$.
  Puedes pegarlo en
  [#43](https://github.com/thinwindow/thinwindow/issues/43), y ayuda a
  decidir qué construye ThinWindow después.
- **No se recolecta nada de forma automática.**

## Cómo se comprueba

ThinWindow publicaba antes un porcentaje de benchmark por modelo. Desde 0.4.0
se comprueba con otro método
([#28](https://github.com/thinwindow/thinwindow/issues/28)):

- **Cada mecanismo tiene tests unitarios,** que corren en CI en macOS, Linux y
  Windows.
- **Las ideas se prueban primero repitiendo sesiones grabadas,** sin costo de
  modelo, para ver qué está en juego.
- **Unas pocas corridas de agente dirigidas** responden lo que solo un modelo
  puede responder, con los criterios de aprobación escritos antes de la primera
  corrida.
- **0.4.0 se validó antes del lanzamiento** contra Claude Code sin el plugin,
  en repositorios reales de código abierto. Su método y sus reglas de
  aprobación se publicaron antes de la primera corrida
  ([#38](https://github.com/thinwindow/thinwindow/issues/38)).
  - Todas las tareas del benchmark y todas las cadenas de retomada se
    completaron con ThinWindow, igual que sin él.
  - Cuando la segunda tarea de una cadena empezó de cero después de que venció
    la caché de prompts, costó menos por cadena completada que seguir.

El método, las filas crudas y las transcripciones depuradas de los agentes son
públicos: [`bench/README.md`](bench/README.md) (en inglés).

## Configuración

ThinWindow funciona sin configuración. Para cambiarla, crea `.thinwindow.json`
en un proyecto, o `~/.thinwindow.json` en tu carpeta personal. Los valores del
proyecto tienen prioridad sobre los de la carpeta personal.

| Clave | Por defecto | Qué hace |
| --- | --- | --- |
| `enabled` | `true` | `false` apaga todos los hooks |
| `maxReadLines` | `400` | Líneas a partir de las cuales se acorta la lectura de un archivo entero |
| `rewrite` | `true` | Corrige en el lugar las llamadas derrochadoras; `false` las rechaza |
| `briefs` | `true` | `false` deja de guardar los resúmenes de sesión |
| `coldResumeNotice` | `true` | `false` apaga el aviso de sesión vencida |
| `coldResumeMinTokens` | `100000` | Contexto mínimo para el que el aviso retiene un prompt |
| `setupNotice` | `true` | `false` apaga el aviso de costo de configuración |
| `setupNoticeMinTokens` | `40000` | Primera solicitud mínima para la que se muestra el aviso |
| `noisyCommands` | lista integrada | Patrones extra de comandos ruidosos |
| `allowlist.paths`, `allowlist.commands` | `[]` | Archivos y comandos que ThinWindow nunca toca |

Todas las opciones, y qué hace cada hook:
[docs/configuration.md](docs/configuration.md) (en inglés).

## Actualizar desde 0.3.0

Nada de lo que funcionaba deja de funcionar, y cada parte nueva tiene su propio
interruptor.

- **Hooks nuevos:** al final de cada turno (el resumen y el aviso de costo de
  configuración) y antes de cada prompt (el aviso de sesión vencida).
- **Comandos nuevos:** `/thinwindow:resume`, `/thinwindow:brief` y
  `/thinwindow:report`. Los escribes tú; no agregan nada al listado de skills
  que ve Claude.
- **Interruptores nuevos:** `briefs`, `coldResumeNotice`,
  `coldResumeMinTokens`, `setupNotice` y `setupNoticeMinTokens`.
- **Nuevo y opcional:** el perfil `thinwindow-minimal`, un archivo que copias.
- **Cambiaron:** las reglas, que dicen lo mismo en menos palabras.

## Qué lee, escribe y envía

- **Lee:**
  - la llamada que Claude Code les pasa a los hooks (una ruta de archivo, un
    comando o un patrón de búsqueda), y la cantidad de líneas y el índice de
    los archivos que Claude está por leer o imprimir;
  - su configuración en `.thinwindow.json`;
  - las variables de entorno `THINWINDOW`, `THINWINDOW_DEBUG`,
    `CLAUDE_PROJECT_DIR`, `CLAUDE_PLUGIN_DATA` y
    `CLAUDE_CODE_SESSION_ATTENDED`;
  - antes de cada prompt, los últimos 256 KB de la transcripción de la sesión,
    y los primeros 256 KB cuando corresponde un aviso de sesión vencida;
  - al final de cada turno, la parte de la transcripción escrita desde el turno
    anterior, y sus primeros 256 KB mientras pueda corresponder un aviso de
    costo de configuración;
  - `git status` en la carpeta de la sesión, después de un turno que pudo
    cambiar archivos. `/thinwindow:resume` también corre `git log` ahí, para
    los commits hechos desde el resumen.

  No lee credenciales.
- **Escribe, en la carpeta temporal de tu sistema operativo:**
  - un archivo pequeño por sesión: qué archivos y rangos se leyeron, los
    rechazos recientes, cuándo se mostró por última vez un aviso de sesión
    vencida y conteos de lo que hicieron los hooks;
  - un archivo mínimo por proyecto: cuándo se mostró por última vez el aviso de
    costo de configuración;
  - el log completo de cada comando que pasa por `thinwindow-run`.
- **Escribe, en la carpeta de datos del plugin** (`~/.claude/plugins/data/`):
  un resumen pequeño por sesión, en una carpeta por proyecto. Un resumen guarda
  **fragmentos de tus prompts y de las respuestas de Claude**:
  - el primer prompt, hasta 200 caracteres;
  - los últimos tres pedidos, hasta 80 cada uno;
  - la última respuesta, hasta 1.200;
  - los archivos cambiados;
  - los últimos cuatro comandos, hasta 70 caracteres cada uno, con sus
    códigos de salida.

  `"briefs": false` deja de escribirlos.
- **Borra:** ThinWindow elimina sus archivos cuando cumplen 7 días, la próxima
  vez que corre.
  - Claude Code borra la carpeta de datos del plugin cuando desinstalas el
    plugin.
  - Si quitas ThinWindow de tu cuenta en la app de escritorio de Claude, los
    resúmenes pueden quedar. Borra la carpeta `thinwindow-*` de
    `~/.claude/plugins/data/` para eliminarlos.
- **Envía:** nada. No hay código de red. Un resumen entra a una conversación
  solo cuando escribes `/thinwindow:resume`.

**`/thinwindow:report`** lee tus transcripciones de Claude Code, solo cuando lo
corres.

- **Lee:** `~/.claude/projects/**/*.jsonl` (`$CLAUDE_CONFIG_DIR/projects` si lo
  definiste), una línea a la vez, y los conteos propios de ThinWindow en la
  carpeta temporal. No escribe nada.
- **Imprime:** números agregados, con sus propias etiquetas.
- **Nunca imprime:** prompts, contenido de archivos, comandos, rutas, nombres
  de proyectos, ids de sesión, ni los nombres de tus herramientas, modelos o
  servidores de MCP. Un test lo comprueba.
- **Envía:** nada. Con el comando de barra, los números impresos pasan a formar
  parte de tu conversación, como la salida de cualquier comando. Para dejarlos
  fuera, corre tú el script:
  `! node <carpeta del plugin>/skills/thinwindow/scripts/thinwindow-report.mjs`.

Si Claude Code cambia el formato de sus transcripciones, el reporte dice
"format not recognized" en lugar de imprimir números equivocados.

## Límites

- **ThinWindow está pensado para sesiones largas,** y para volver a sesiones
  grandes. Una tarea corta arrastra poco contexto de entrada.
- **Los hooks necesitan Claude Code.** Los otros agentes reciben las reglas, y
  Cowork y el chat reciben las partes de [Dónde funciona](#dónde-funciona).
- **Los montos en US$ son estimaciones a precio de lista de la API.** No son
  una factura.
- **Sin garantía.** ThinWindow se ofrece "tal cual" bajo la
  [licencia MIT](LICENSE). Los hooks están diseñados para fallar abiertos, y
  los tests lo cubren, pero revisa el código antes de confiarle trabajo real.

## Preguntas frecuentes

**¿Hace que Claude rinda peor en la tarea?**

- En la validación de 0.4.0, todas las tareas del benchmark y todas las
  cadenas de retomada se completaron con ThinWindow tantas veces como sin él.
- Una revisión a ciegas de las respuestas finales las encontró correctas y
  completas en las dos condiciones.
- Todos los controles fallan abiertos.

**¿En qué se diferencia del "Resume from summary" de Claude Code?**

- Ese diálogo aparece cuando haces `--resume` de una sesión grande después de
  alrededor de una hora, en los planes Pro y Max.
- ThinWindow además cubre las sesiones que dejaste abiertas, muestra lo que
  cuesta seguir en tokens y US$ antes de pagarlo, y guarda un resumen para
  cualquier `/clear` posterior.

**¿El aviso de sesión vencida me va a interrumpir?**

- Como mucho una vez por pausa: solo después de una hora inactiva, y solo con
  más de 100k tokens de contexto.
- Vuelve a enviar el prompt para seguir, o apaga el aviso con
  `"coldResumeNotice": false`.

**¿Envía mi código a algún lado?** No.

- No hay código de red: ni analíticas, ni reportes de fallos, ni chequeos de
  actualizaciones.
- Los hooks son scripts de Node locales.

**¿Funciona fuera de Claude Code?**

- Las reglas sí, con Agent Skills o `AGENTS.md`.
- Los hooks necesitan Claude Code.
- Cowork y el chat reciben las partes de [Dónde funciona](#dónde-funciona).

## Contribuir

Los aportes más útiles, en orden:

1. **Una tarea de tu propio stack:** otro lenguaje, un monorepo, un framework
   con mucho código generado.
2. **Una regresión reproducible,** con las filas que la muestran.
3. **Una propuesta de regla o de hook,** con la tabla de cumplimiento
   (`node bench/compliance.mjs`). Cuando la decisión depende de cómo reacciona
   el modelo, suma unas pocas corridas dirigidas, con los criterios de
   aprobación escritos antes de correrlas.

El flujo de trabajo está en [CONTRIBUTING.md](CONTRIBUTING.md) (en inglés).

## Licencia

MIT
