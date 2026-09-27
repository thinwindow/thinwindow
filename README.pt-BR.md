<div align="center">

![Logo do ThinWindow](assets/icon.iconset/icon_128x128.png)

</div>

<h1 align="center">ThinWindow</h1>

<p align="center">
  <strong>Menos na janela. Menos na conta.</strong><br>
  Seu agente paga pelo contexto duas vezes: uma para colocá-lo em cache e outra a cada turno que o relê. Só as releituras são de 87% a 96% dos tokens; os dois pagamentos juntos, de 73% a 84% da conta. O ThinWindow é um plugin do Claude Code e um Agent Skill que reduz esse contexto: de 13% a 19% menos tokens, medidos no Claude Code com três modelos, em oito tarefas de dois repositórios Python e JavaScript.
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.es.md">Español</a> · <b>Português</b>
</p>

<!-- RESULTS:START -->
| Modelo | Tokens (IC 95%) | Tokens, execuções aprovadas | Custo (IC 95%) | Sucesso base → ThinWindow | Interrompidas pelo limite de turnos | Execuções |
| --- | ---: | ---: | ---: | :---: | :---: | ---: |
| Opus 5.5 | −15,8% (−28,3% a +0,4%) | −15,8% | −19,4% (−26,2% a −10,2%) | 16/16 → 16/16 | 0/16 → 0/16 | 32 |
| Sonnet 5 | −13,2% (−30,4% a +7,0%) | −13,2% | −7,9% (−18,4% a +2,5%) | 24/24 → 24/24 | 0/24 → 0/24 | 48 |
| Haiku 4.5 | −23,0% (−36,0% a −10,8%) | −18,8% | −20,2% (−30,5% a −10,9%) | 14/16 → 13/16 | 7/16 → 3/16 | 32 |

As mesmas 8 tarefas, 112 execuções, um agente por execução, sem descartar
nenhuma: tudo o que foi registrado está na tabela, exceto as execuções que uma
versão posterior do código substituiu na mesma tarefa, guardadas em
[`bench/results/archive/`](bench/results/archive). O detalhe por tarefa e os
dados brutos estão em [Benchmark](#benchmark).

A faixa de 13% a 19% no topo conta só as execuções que passaram na verificação oculta. No Haiku 4.5, isso dá −18,8% nas 7 tarefas em que as duas condições têm uma execução aprovada, contra −23,0% nas 8. Opus 5.5 e Sonnet 5 passaram em todas as execuções. No Haiku 4.5, as execuções com ThinWindow falharam na verificação oculta mais vezes que as de base: 3 de 16 contra 2 de 16. IC 95%: bootstrap sobre as tarefas. Onde inclui o zero, a mudança não se distingue de nenhuma neste conjunto de tarefas. Uma execução interrompida pelo limite de turnos terminou no limite antes de o agente acabar; seus tokens não são comparáveis com os de uma execução concluída.
<!-- RESULTS:END -->

## Por que o contexto pesa na conta

Um agente de código não paga principalmente pelo que escreve. Paga pelo que
carrega. Cada arquivo que abre, cada log de instalação que imprime e cada grep
amplo que roda é anexado à conversa, e a conversa inteira é reenviada a cada
turno seguinte. O custo de uma sessão se parece mais com

```
tokens ≈ tamanho do contexto × turnos
```

do que com o tamanho da resposta. Nas execuções base medidas aqui, **de 87% a 96%
de todos os tokens cobrados foram leituras de cache** — contexto reenviado, turno
após turno — contra 0,6% a 1,9% da saída do próprio agente:

<!-- CACHE:START -->
| Modelo | Parcela de | Leituras de cache | Escritas de cache | Saída |
| --- | --- | ---: | ---: | ---: |
| Opus 5.5 | tokens | 92,0% | 6,6% | 1,3% |
|  | custo | 18,8% | 54,3% | 26,9% |
| Sonnet 5 | tokens | 87,1% | 11,0% | 1,9% |
|  | custo | 21,6% | 54,4% | 24,0% |
| Haiku 4.5 | tokens | 96,4% | 2,9% | 0,6% |
|  | custo | 51,9% | 31,6% | 16,4% |
<!-- CACHE:END -->

Com preços, as mesmas execuções ficam diferentes (as linhas de custo): uma
leitura de cache custa um décimo de um token de entrada ou menos, uma escrita de
cache o dobro de um, e a saída cinco vezes um. Pedir brevidade ao agente mexe na
coluna de saída, que é pequena em tokens mas não em custo. Impedir que ele puxe
um arquivo de 2.000 linhas para o contexto no turno 3 mexe nas duas colunas de
cache, em todos os turnos seguintes.

O ThinWindow ataca os dois fatores: encolhe o que entra no contexto e evita os
turnos extras gastos lidando com uma saída de que o agente nunca precisou.
Como a conta se divide por tipo de token, o que o agente chama e o que acontece
com as execuções que não terminam: [Where the tokens go](docs/WHERE-THE-TOKENS-GO.md)
(em inglês).

## Instalação

**Claude Code** (regras + hooks, a versão completa):

```
/plugin marketplace add thinwindow/thinwindow
/plugin install thinwindow@thinwindow
```

**Qualquer agente com Agent Skills** (Codex, Cursor, Copilot, Gemini CLI,
OpenCode...), somente as regras:

```
npx skills add thinwindow/thinwindow
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
2. **Hooks** (só no Claude Code) que garantem a parte cara sem custar um turno
   ao agente:
   - Um `Read` completo de um arquivo com mais de 400 linhas devolve as primeiras
     120 linhas mais um índice numerado, para que a próxima leitura mire um
     intervalo.
   - A releitura de um arquivo sem alterações que já está no contexto é recusada.
   - Instalações, builds, testes e linters passam pelo `thinwindow-run`: o log
     completo vai para um arquivo temporário e o agente vê o código de saída, o
     final do log e as linhas de erro.
   - `cat` de arquivos enormes, lockfiles ou arquivos minificados, `git log` sem
     `-n`, `ls -R`, `tree` sem `-L` e `find` sem limite recebem uma alternativa
     mais barata. O `Grep` por conteúdo recebe `head_limit: 100`.
3. **Falha em modo aberto.** Qualquer erro de hook deixa a chamada passar.
   Repetir uma leitura ou um comando ruidoso recusados também os deixa passar,
   e os poucos comandos sempre recusados vêm com um substituto que funciona,
   então o agente nunca fica travado.

As regras são garantidas pelos hooks em vez de ficarem a cargo do modelo, porque uma
regra que o agente pode esquecer sob pressão não é uma regra. Os hooks rodam na
chamada da ferramenta, antes de o resultado chegar ao contexto, então aplicá-las
não custa um turno.

Sem dependências, sem telemetria, Node 18+. Detalhes e todas as opções:
[docs/configuration.md](docs/configuration.md).

### O que lê, o que escreve e o que envia

- **Lê:** a chamada de ferramenta que o Claude Code passa aos hooks (um
  caminho, um comando ou um padrão de busca); o número de linhas e um índice
  dos arquivos que o agente vai ler ou imprimir; suas configurações em
  `.thinwindow.json`, no projeto e na sua pasta de usuário; e as variáveis de
  ambiente `THINWINDOW`, `THINWINDOW_DEBUG` e `CLAUDE_PROJECT_DIR`. Não lê
  credenciais.
- **Escreve:** só no diretório temporário do sistema operacional: um JSON
  pequeno por sessão (quais arquivos e intervalos foram lidos, as recusas
  recentes e a contagem do que os hooks fizeram) e o log completo de cada
  comando executado pelo `thinwindow-run`. Os dois são apagados após 7 dias.
- **Envia:** nada. Não há código de rede.

## Benchmark

<!-- BENCH:START -->
Três modelos, 8 tarefas, 112 execuções. Os gráficos e as tabelas são gerados por
[`bench/report.mjs`](bench/report.mjs) a partir dos arquivos brutos.

### Opus 5.5

![Mudança em tokens totais por tarefa, Opus 5.5: à esquerda do zero, menos tokens com ThinWindow; as barras de erro cobrem cada par de execuções](bench/results/chart-claude-opus-5-5.svg)

### Sonnet 5

![Mudança em tokens totais por tarefa, Sonnet 5: à esquerda do zero, menos tokens com ThinWindow; as barras de erro cobrem cada par de execuções](bench/results/chart-claude-sonnet-5.svg)

### Haiku 4.5

![Mudança em tokens totais por tarefa, Haiku 4.5: à esquerda do zero, menos tokens com ThinWindow; as barras de erro cobrem cada par de execuções](bench/results/chart-claude-haiku-4-5.svg)
<!-- BENCH:END -->

As tabelas por tarefa, com a dispersão e a taxa de sucesso, estão em
[`bench/results/report.md`](bench/results/report.md) e na
[seção Benchmark do README em inglês](README.md#benchmark) (são geradas em
inglês, por isso não as duplico aqui e assim ficam sempre atualizadas). As
execuções brutas, uma linha por execução, estão em
[`bench/results/`](bench/results).

### Como é medido

Cada **execução** é um agente resolvendo uma tarefa do zero:

1. Clonar um repositório real de código aberto
   ([click](https://github.com/pallets/click) ou
   [commander.js](https://github.com/tj/commander.js)) num commit fixo, dentro de
   um diretório temporário novo.
2. Instalar as dependências antes de o agente começar, para que os logs de
   instalação não sejam cobrados de nenhum dos lados.
3. Rodar `claude -p "<tarefa>"` com o modelo escolhido, com teto de 40 turnos. A
   *baseline* usa o Claude Code puro; o *ThinWindow* usa o mesmo mais este
   plugin. Nada mais muda: sem servidores MCP, sem configurações de usuário, sem
   memória entre execuções.
4. Rodar a verificação oculta da tarefa: um teste ou script que o agente nunca
   vê. Código de saída 0 é sucesso.
5. Registrar tokens (entrada, escritas e leituras de cache, saída, subagentes
   incluídos), custo, turnos e tempo a partir do JSON do próprio Claude Code,
   mais o rastro completo de chamadas de ferramentas.

As 8 tarefas são uma mistura de trabalho do dia a dia: correções de bugs com um teste que
falha, uma funcionalidade pequena, uma renomeação entre arquivos, uma
refatoração, uma consulta de configuração e "fazer o ano do copyright do rodapé se
atualizar sozinho". As definições estão em [`bench/tasks/`](bench/tasks).

As execuções são sequenciais, uma de cada vez, então nunca disputam os limites
de uso. O custo é o preço equivalente de API que o Claude Code informa; numa
assinatura você paga em limites de uso, mas a proporção é a mesma.

### Verifique em vez de acreditar

- Cada execução é uma linha de JSONL em [`bench/results/`](bench/results), com o
  modelo, a versão do Claude Code, o commit do ThinWindow, as contagens brutas
  de tokens e o rastro de ferramentas. Nenhum número deste README é escrito à
  mão.
- Uma tarefa foi medida de novo depois de uma correção. No Sonnet 5, todas as
  execuções com o ThinWindow de commander-ci-config cortaram
  `cat .github/workflows/*.yml` em 60 linhas e perderam o arquivo que a tarefa
  pede; agora o hook mantém inteiras as concatenações curtas
  ([#7](https://github.com/thinwindow/thinwindow/issues/7)). As três execuções
  com o ThinWindow dessa tarefa foram refeitas em 30e9c6b (+29,3% → +3,9%), e as
  três que elas substituem estão em [`bench/results/archive/`](bench/results/archive).
  Nenhuma outra execução registrada faz essa chamada, então nenhuma outra tarefa
  foi refeita.
- As regras foram ajustadas nessas mesmas 8 tarefas, em duas bibliotecas de
  parsing de argumentos de linha de comando, em JavaScript e Python. É uma fatia
  estreita do software que existe. Sua economia em outros trabalhos será
  diferente.
- As amostras são pequenas. Agentes variam muito: a mesma tarefa levou 4 turnos
  em uma execução e 9 na seguinte (commander-extract-utils no Sonnet 5, sem o
  ThinWindow), por isso as tabelas mostram medianas e a faixa por tarefa, e não
  uma única média de manchete.
- Rode contra a sua própria conta e os seus próprios limites:

  ```
  node bench/run.mjs --condition baseline,thinwindow --reps 3 --model sonnet --dry-run
  node bench/run.mjs --condition baseline,thinwindow --reps 3 --model sonnet --max-cost 10
  node bench/report.mjs
  ```

  Todas as opções estão em [bench/README.md](bench/README.md).

### Onde ainda há margem

Estes números são uma medição atual, não um teto. Eles vão se mover conforme
mudarem as regras, os modelos e o próprio Claude Code, e a intenção é continuar
melhorando e republicar os arquivos brutos a cada vez.

Duas coisas aparecem nos dados:

- **Nem toda tarefa melhora.** No Sonnet 5, três das oito tarefas ainda custam
  mais com o ThinWindow do que sem ele. Só neutralizar essas regressões — sem
  economizar um token a mais em nenhum outro lugar — levaria o Sonnet de −13,2%
  para cerca de −17,5%, e o Opus de −15,8% para cerca de −17,7%. A margem de
  curto prazo está mais em não piorar as tarefas curtas do que em espremer as
  longas. O que os rastros mostram de cada uma está na
  [#7](https://github.com/thinwindow/thinwindow/issues/7).
- **Os turnos são o fator inexplorado.** Como o custo é aproximadamente contexto
  × turnos, um turno economizado vale tanto quanto uma leitura grande evitada. O
  Opus usou 12,9% menos turnos aqui e cortou o custo em 19,4%; o Sonnet usou os
  mesmos turnos que sem o ThinWindow e cortou o custo em 7,9%. Uma tentativa
  anterior de regras explícitas de "use menos turnos" piorou o Sonnet de forma
  mensurável e foi revertida, em vez de mantida e silenciosamente excluída: esse
  experimento revertido continua no histórico.

## O que o ThinWindow faz com a saída das ferramentas

Estes números medem o tamanho da saída das ferramentas, não o custo. Vêm de uma
repetição sem modelo: cada chamada a Read e Bash das execuções base é executada
de novo, em um clone novo do repositório da sua tarefa, uma vez como o agente a
enviou e outra como os hooks do ThinWindow a reescrevem ou recusam, e
comparam-se os caracteres que o agente receberia. As chamadas que olham as
mudanças do próprio agente (`git diff`, os testes) veem o repositório sem
modificações, então seus tamanhos não são os que o agente viu. A repetição é determinística,
exceto pelos tempos e caminhos temporários da saída, que mudam os totais em
poucos caracteres de uma repetição para outra. Não precisa de chave de API;
precisa de rede para os clones e a instalação de dependências, e leva de 15 a 25
minutos em um notebook, quase tudo rodando os testes de novo:
`node bench/input-size.mjs`, que grava
[`bench/results/input-size.json`](bench/results/input-size.json).

Reduzir a saída das ferramentas não é reduzir a conta. A saída das ferramentas
é uma parte do que entra no contexto; o contexto é uma parte dos tokens; e os
tokens são uma parte do custo, cada tipo ao seu preço. O efeito se dilui a cada
passo. [Where the tokens go](docs/WHERE-THE-TOKENS-GO.md) (em inglês) mostra
como a conta se divide.

<!-- TIER1:START -->
| Modelo | Chamadas nos rastros base | Repetidas | Alteradas pelos hooks | Saída das chamadas repetidas (caracteres) | Mudança |
| --- | ---: | ---: | ---: | ---: | ---: |
| Opus 5.5 | 106 | 52 | 2 | 83.853 → 84.720 | +1,0% |
| Sonnet 5 | 134 | 66 | 3 | 114.982 → 115.879 | +0,8% |
| Haiku 4.5 | 366 | 250 | 41 | 861.988 → 524.951 | −39,1% |

Não repetidas: 183 chamadas que o rastro cortou (ele guarda 140 caracteres de cada), 33 que escrevem arquivos, rodam um script ou mudam o repositório, e 22 cujo arquivo não pôde ser identificado.

A mudança na conta é outra grandeza, medida em [Benchmark](#benchmark), e não do mesmo tamanho:
- Opus 5.5: os hooks alteram 2 de 106 chamadas e aumentam a saída repetida em 1,0%; no benchmark agiram em 1 de 16 execuções com ThinWindow, e a mudança medida no custo é −19,4% (IC 95% −26,2% a −10,2%).
- Sonnet 5: os hooks alteram 3 de 134 chamadas e aumentam a saída repetida em 0,8%; no benchmark agiram em 3 de 24 execuções com ThinWindow, e a mudança medida no custo é −7,9% (IC 95% −18,4% a +2,5%).
- Haiku 4.5: os hooks alteram 41 de 366 chamadas e reduzem a saída repetida em 39,1%; no benchmark agiram em 9 de 16 execuções com ThinWindow, e a mudança medida no custo é −20,2% (IC 95% −30,5% a −10,9%).

Onde os hooks quase não agem, a mudança medida vem das regras, que mudam o que o agente faz, ou do ruído entre execuções, não de cortar a saída das ferramentas.
<!-- TIER1:END -->

## Contribuindo

Este é exatamente o tipo de projeto que melhora com a carga de trabalho de
outras pessoas, porque os limites acima são os limites da amostra de *uma
pessoa só*.

O mais útil, mais ou menos em ordem:

1. **Resultados de benchmark com a sua stack.** Uma tarefa nova em
   [`bench/tasks/`](bench/tasks) — outra linguagem, um monorepo, um framework
   com muito código gerado — vale mais que uma opinião sobre as regras.
2. **Uma regressão reproduzível.** Um caso em que o ThinWindow custe mais que a
   baseline, com o JSONL que comprove, é um presente: as regressões acima são o
   caminho mais claro para números melhores.
3. **Propostas de regras e hooks**, com a medição que as justifique. As regras
   são testadas contra o benchmark, não aceitas por soarem plausíveis; além disso,
   o arquivo de regras tem um orçamento de tokens que a CI faz cumprir.

O fluxo está em [CONTRIBUTING.md](CONTRIBUTING.md).

## Escopo, limitações e isenção de responsabilidade

Isto começou como uma ferramenta pessoal. Eu a criei para reduzir o custo do meu
próprio fluxo de trabalho, e publiquei porque as medições podem ser úteis para
outra pessoa — não porque seja um produto acabado com um contrato de suporte por
trás.

Leia os números com isso em mente:

- **O benchmark é estreito e escolhido por mim.** Oito tarefas, dois
  repositórios, três modelos, algumas repetições cada, tudo escolhido por mim,
  com regras ajustadas contra essas mesmas tarefas. Dá para mostrar uma direção;
  não dá para prometer uma porcentagem a você. Está publicado por inteiro, com
  os arquivos brutos, justamente para que você julgue o quanto generaliza em vez
  de acreditar num número de manchete.
- **A contabilidade de tokens é volátil por natureza.** O que entra numa janela
  de contexto depende da versão do modelo, do ambiente de execução do agente e do
  seu prompt de sistema, da taxa de acerto de cache, de quais ferramentas estão
  habilitadas, dos servidores MCP, do tamanho do repositório e de como a tarefa
  se desenrola naquele dia. Qualquer um desses fatores pode mover o resultado
  mais que o efeito medido aqui. Duas execuções idênticas da mesma tarefa podem
  divergir bastante; as medianas e faixas das tabelas existem para tornar isso
  visível, não para escondê-lo.
- **Os resultados envelhecem.** Foram medidos com uma versão específica do
  Claude Code e snapshots específicos dos modelos, e ambos mudam com frequência.
  Serão medidos de novo, em vez de continuarem publicados sem revisão.
- **Sem garantia.** Este software é fornecido "como está" sob a
  [licença MIT](LICENSE), sem garantia de nenhum tipo. Você é responsável pelo
  que roda no seu ambiente e pelo que gasta. Os hooks são projetados para falhar
  em modo aberto e nunca bloquear uma chamada, e os testes cobrem esse comportamento,
  mas nenhuma quantidade de testes é uma garantia: revise o código, rode os
  testes e experimente num branch antes de confiar trabalho real a ele.
- **Não substitui um bom prompt.** Ele remove desperdício; não deixa o agente
  mais inteligente.

## Perguntas frequentes

**Isso deixa meu agente pior na tarefa?** É o que a coluna de sucesso em cada
tabela mede. Uma economia que faz a tarefa falhar não é economia. Nos três
modelos o sucesso foi idêntico ao da baseline, exceto em uma tarefa do Haiku,
commander-rename-display-width: 1/2 sem o ThinWindow, 0/2 com ele. O Haiku tem
dificuldade nessa tarefa de qualquer jeito: três das quatro execuções falharam,
e todas levaram 35 turnos ou mais.

**Por que não simplesmente pedir ao agente para ser breve?** Ajuda, e as regras
pedem isso: a saída é só de 0,6% a 1,9% dos tokens, mas a cinco vezes o preço da
entrada é de 16% a 27% do custo (veja [Por que o contexto pesa na
conta](#por-que-o-contexto-pesa-na-conta)). O resto é contexto: uma resposta
longa é paga uma vez, enquanto uma leitura longa é escrita no cache uma vez e
lida de novo a cada turno seguinte.

**Ele envia meu código ou telemetria para algum lugar?** Não. Não há código de
rede neste projeto: sem analytics, sem relatórios de erro, sem "estatísticas
anônimas de uso", sem checagem de licença ou de atualização. Os hooks são
scripts locais de Node que leem a chamada da ferramenta e devolvem uma decisão;
os logs truncados vão para um arquivo temporário no seu próprio disco. A única
coisa que sai da sua máquina é o que o seu agente já estava mandando para o seu
provedor de modelos — e o objetivo desta ferramenta é que isso seja menor.

**Funciona fora do Claude Code?** As regras sim, via Agent Skills ou
`AGENTS.md`. Os hooks — que fazem o trabalho pesado — são exclusivos do Claude
Code, porque dependem da API de hooks do Claude Code para chamadas de ferramentas.

## Licença

MIT
