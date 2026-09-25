# thinwindow

[English](README.md) · [Español](README.es.md) · **Português**

**Faça os agentes de código lerem menos.** Menos tokens por tarefa, os mesmos
resultados e um benchmark que você mesmo pode rodar de novo.

| Modelo | Tokens | Custo | Sucesso base → thinwindow | Execuções |
| --- | ---: | ---: | :---: | ---: |
| Haiku 4.5 | **−23,0%** | **−20,2%** | **14/16** → **13/16** | 32 |
| Sonnet 5 | **−11,6%** | **−7,4%** | **24/24** → **24/24** | 48 |
| Opus 5.5 | **−15,8%** | **−19,4%** | **16/16** → **16/16** | 32 |

As mesmas 8 tarefas, 112 execuções, um agente por execução. O detalhe por
tarefa, a dispersão e os dados brutos estão em [Benchmark](#benchmark).

Quase tudo o que um agente de código paga é entrada, não saída: ler arquivos
inteiros, logs de instalação e de testes, greps amplos. Tudo o que ele lê fica no
contexto e é reenviado a cada turno seguinte, então uma leitura logo no começo de
2.000 linhas é paga de novo em todos os turnos posteriores. O thinwindow corta
isso na fonte e, de quebra, enxuga o que o agente escreve e comenta.

## Instalação

**Claude Code** (regras + hooks, a versão completa):

```
/plugin marketplace add imprvhub/thinwindow
/plugin install thinwindow@thinwindow
```

**Qualquer agente com Agent Skills** (Codex, Cursor, Copilot, Gemini CLI,
OpenCode...), somente as regras:

```
npx skills add imprvhub/thinwindow
```

**Agentes que leem `AGENTS.md`**: cole [`adapters/AGENTS.md`](adapters/AGENTS.md)
no `AGENTS.md` do seu projeto.

Desligue quando quiser com `THINWINDOW=off`, ou com `"enabled": false` no
`.thinwindow.json`.

## Como funciona

1. **Regras** ([`rules/thinwindow.md`](rules/thinwindow.md), menos de 500 tokens)
   carregadas no início da sessão: localizar antes de ler, ler por intervalos,
   limitar a saída dos comandos, escrever a menor mudança possível, encerrar com
   no máximo três linhas.
2. **Hooks** (só no Claude Code) que aplicam a parte cara, sem gastar um turno do
   agente:
   - Um `Read` completo de um arquivo com mais de 400 linhas devolve as primeiras
     120 linhas mais um índice numerado, para que a próxima leitura mire um
     intervalo.
   - Reler um arquivo sem alterações que já está no contexto é recusado.
   - Instalações, builds, testes e linters passam pelo `thinwindow-run`: o log
     completo vai para um arquivo temporário e o agente vê o código de saída, o
     final do log e as linhas de erro.
   - `cat` de arquivos enormes, lockfiles ou arquivos minificados, `git log` sem
     `-n`, `ls -R`, `tree` sem `-L` e `find` sem limite recebem uma substituição
     mais barata. O `Grep` por conteúdo recebe `head_limit: 100`.
3. **Falha aberto.** Qualquer erro de hook deixa a chamada passar. Repetir uma
   chamada recusada também passa, então o agente nunca trava.

Sem dependências, sem telemetria, Node 18+. Detalhes e todas as opções:
[docs/configuration.md](docs/configuration.md).

## Benchmark

Três modelos, 112 execuções. As tabelas por tarefa são geradas por
[`bench/report.mjs`](bench/report.mjs) a partir dos arquivos brutos; nada é
escrito à mão.

- **Tabelas detalhadas por tarefa** (em inglês, geradas):
  [`bench/results/report.md`](bench/results/report.md) ou a seção
  [Benchmark do README em inglês](README.md#benchmark).
- **Execuções brutas**, uma linha por execução:
  [`haiku-528598a.jsonl`](bench/results/haiku-528598a.jsonl) ·
  [`sonnet-528598a.jsonl`](bench/results/sonnet-528598a.jsonl) ·
  [`opus-528598a.jsonl`](bench/results/opus-528598a.jsonl)
- **Gráficos**: [Haiku](bench/results/chart-claude-haiku-4-5.svg) ·
  [Sonnet](bench/results/chart-claude-sonnet-5.svg) ·
  [Opus](bench/results/chart-claude-opus-5-5.svg)

A economia depende muito da tarefa: as que exigem ler bastante são as que mais
caem (por exemplo `click-help-spec` no Sonnet: −55,3%), e alguma tarefa curta sai
levemente pior. A saída cai nos três modelos.

### Como é medido

Cada **execução** é um agente resolvendo uma tarefa do zero:

1. Clonar um repositório real de código aberto
   ([click](https://github.com/pallets/click) ou
   [commander.js](https://github.com/tj/commander.js)) num commit fixo, dentro de
   um diretório temporário novo.
2. Instalar as dependências antes de o agente começar, para que os logs de
   instalação não contem para nenhum dos lados.
3. Rodar `claude -p "<tarefa>"` com o modelo escolhido, até 40 turnos. A
   *baseline* usa o Claude Code puro; o *thinwindow* usa o mesmo mais este
   plugin. Nada mais muda: sem servidores MCP, sem configurações de usuário.
4. Rodar a verificação oculta da tarefa (um teste ou script que o agente nunca
   vê). Código de saída 0 é sucesso.
5. Registrar tokens (entrada, escritas e leituras de cache, saída, subagentes
   incluídos), custo, turnos e tempo a partir do JSON que o próprio Claude Code
   devolve.

As 8 tarefas são a mistura do dia a dia: correções de bugs com um teste que
falha, uma funcionalidade pequena, uma renomeação entre arquivos, uma
refatoração, uma busca de configuração e "fazer o ano do copyright do rodapé se
atualizar sozinho". Os arquivos das tarefas estão em
[`bench/tasks/`](bench/tasks).

As execuções são sequenciais, uma de cada vez, então nunca disputam os limites de
uso. O custo é o preço equivalente de API que o Claude Code informa; numa
assinatura você paga em limites de uso, mas a proporção é a mesma.

**Desconfie, e confira:**

- Cada execução é uma linha num arquivo JSONL em
  [`bench/results/`](bench/results), com o modelo, a versão do Claude Code, o
  commit do thinwindow e as contagens brutas de tokens.
- As regras foram ajustadas nessas mesmas 8 tarefas. Sua economia em outros
  trabalhos pode ser menor ou maior.
- As amostras são pequenas. Agentes são barulhentos: a mesma tarefa pode levar 4
  turnos numa vez e 15 na seguinte, por isso as tabelas mostram medianas e a
  faixa por tarefa.
- Rode você mesmo (usa a sua própria sessão do Claude Code e os seus limites):

  ```
  node bench/run.mjs --condition baseline,thinwindow --reps 3 --model sonnet --dry-run
  node bench/run.mjs --condition baseline,thinwindow --reps 3 --model sonnet --max-cost 10
  node bench/report.mjs
  ```

  Todas as opções estão em [bench/README.md](bench/README.md).

## Perguntas frequentes

**Isso deixa meu agente mais burro?** A taxa de sucesso em cada tabela mede
exatamente isso. Uma economia que faz a tarefa falhar não conta como economia.

**Por que não simplesmente pedir ao agente para ser breve?** A saída é a parte
barata. Uma resposta longa é paga uma vez; uma leitura longa é paga de novo a
cada turno seguinte. O thinwindow também enxuga a saída, mas a maior parte da
economia está do lado da entrada.

**Ele envia dados para algum lugar?** Não. Nada sai da sua máquina.

## Licença

MIT
