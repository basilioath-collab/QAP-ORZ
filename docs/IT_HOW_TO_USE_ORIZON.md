# ORIZON — IT, How to use e norte do usuário

## 1. Objetivo do aplicativo

O ORIZON é uma plataforma local/PWA para planejar capacidade, demandas, execução real e sincronização de base de dados. O app foi avaliado a partir das abas e fluxos disponíveis na interface: Visão Geral, Apontamentos, Demandas, Recursos, Bloqueio de Janela, Horas Extras, Janelas Livres, Lançamentos, Execução diária e Sincronização de BD.

Use este documento como:

- **IT (Instrução de Trabalho):** passo a passo operacional para manter o planejamento confiável.
- **How to use:** guia prático para usar cada aba.
- **Norte do usuário:** regras de decisão para saber o que lançar, quando ajustar e como interpretar os indicadores.

---

## 2. Conceitos essenciais

| Conceito | O que significa | Impacto no app |
|---|---|---|
| Recurso | Pessoa/capacidade cadastrada no planejamento. | Define capacidade diária e recebe demandas/apontamentos. |
| Interno | Recurso com jornada padrão de 9h/dia. | Base de cálculo de ocupação diária/mensal. |
| Terceiro | Recurso com jornada padrão de 8h/dia e vigência. | Fora da vigência aparece como OFF e não soma capacidade. |
| Demanda | Trabalho planejado com título, datas, status, prioridade, prédio, focal e responsáveis. | Consome capacidade conforme horas/dia reservadas. |
| Mapeada | Demanda sem responsável definido. | Não consome capacidade até ser atribuída. |
| Em andamento | Demanda ativa em execução/planejamento. | Consome capacidade no intervalo planejado. |
| Congelada | Demanda pausada. | Deve ser usada quando o trabalho existe, mas não deve avançar. |
| Concluída | Demanda finalizada. | Sai da visão de demandas abertas. |
| Apontamento | Registro de execução real em uma demanda. | Alimenta métricas de consumo, aderência e execução diária. |
| Lançamento interno | Atividade sem demanda vinculada, como reunião, suporte e acompanhamento. | Conta como esforço real do recurso, mas não como consumo de demanda. |
| Bloqueio/Feriado/Férias/OFF | Dia sem capacidade disponível. | Zera ou reduz janelas livres. |
| HE | Hora extra. | Aumenta visão de esforço executado/necessário fora da jornada normal. |
| Janelas livres | Capacidade remanescente por recurso/período. | Ajuda a decidir onde encaixar novas demandas. |
| ORIZONData/events | Pasta recomendada para sincronização multiusuário por eventos. | Mantém snapshot e arquivos de usuários/eventos integrados. |

---

## 3. IT — Instrução de Trabalho operacional

### 3.1 Preparação inicial

1. Abra o ORIZON em um navegador compatível, preferencialmente Chrome ou Edge atualizado.
2. Defina seu usuário no cabeçalho ou no modal de usuário.
3. Vá em **Sincronização de BD**.
4. Prefira **Conectar pasta de eventos / ORIZONData** quando existir uma pasta compartilhada de equipe.
5. Se for manutenção ou uso individual, selecione o JSON oficial em modo ler/gravar quando o navegador permitir.
6. Confirme se o aviso de BD desconectado desapareceu ou se a pasta de eventos aparece conectada.

### 3.2 Cadastro de capacidade

1. Acesse **Recursos**.
2. Cadastre cada pessoa com nome, tipo, status e vigência quando for terceiro.
3. Use **Interno** para 9h/dia e **Terceiro** para 8h/dia.
4. Para terceiros, informe vigência inicial e final; dias fora da vigência não devem ser considerados capacidade.
5. Revise a lista de recursos e edite ou exclua registros incorretos.

### 3.3 Cadastro de demandas

1. Acesse **Demandas**.
2. Informe título, prédio, focal, datas, prioridade, status, responsáveis e observações.
3. Para demandas ainda sem responsável, use **Mapeada**.
4. Para demandas com execução prevista, selecione um ou mais responsáveis.
5. Ajuste as horas/dia reservadas por responsável; não use apenas percentual mental, pois o app calcula ocupação em horas.
6. Salve a demanda e valide se ela aparece nas tabelas e na Visão Geral.

### 3.4 Ajustes de demanda

Use as ações da demanda para:

- **Editar** dados cadastrais e responsáveis.
- **Alterar situação** com justificativa quando mudar para concluída, congelada ou outro status.
- **Reprogramar** o prazo final com justificativa obrigatória.
- **Etapas / apontamentos** para registrar ou revisar execução real.

Regra de governança: toda alteração que mude prazo, status ou responsabilidade deve ter motivo claro nas observações/justificativa.

### 3.5 Bloqueios, feriados e indisponibilidades

1. Acesse **Bloqueio de Janela**.
2. Cadastre bloqueios por data ou intervalo.
3. Use bloqueio para ausências, indisponibilidades, férias, feriados operacionais e dias sem capacidade.
4. Revise a lista paginada e remova bloqueios incorretos.
5. Depois de bloquear, confira **Janelas Livres** para ver o efeito na capacidade.

### 3.6 Horas extras

1. Acesse **Horas Extras (HE)**.
2. Clique em adicionar HE.
3. Informe título/atividade, recurso ou todos, data, horas, prioridade e motivo obrigatório.
4. Use prédio, focal e observações para rastreabilidade.
5. Exclua apenas lançamentos claramente errados.

### 3.7 Apontamentos reais

1. Acesse **Lançamentos** ou abra uma demanda e registre apontamentos.
2. Escolha demanda, etapa/tipo de atividade, data e horas.
3. Use apontamentos antes do início planejado apenas quando a execução realmente começou antes.
4. Use apontamentos depois do prazo apenas quando houve trabalho real fora da janela planejada.
5. Revise o histórico recente e edite/remova apontamentos incorretos.

### 3.8 Acompanhamento diário

1. Acesse **Execução diária**.
2. Selecione a data de análise.
3. Analise demandas mensais, execução por recurso, aderência e apontamentos.
4. Exporte CSV quando precisar enviar o status do dia ou período.

### 3.9 Análise de capacidade

1. Acesse **Visão Geral** para KPIs executivos, ocupação anual e visão por recurso.
2. Use filtros por status, recurso, título e datas.
3. Clique nos agrupamentos/gráficos para detalhar demandas quando disponível.
4. Acesse **Janelas Livres** para encontrar capacidade remanescente por recurso e mês.
5. Abra o drilldown diário para entender onde há gargalo, folga, bloqueio, férias/OFF ou HE.

### 3.10 Exportações e backup

1. Use **Exportar CSV** para demandas, recursos, bloqueios, feriados, HE, janelas livres, pacote de análise e exportação completa em Excel `.xls`.
2. Em **Sincronização de BD**, exporte snapshot quando precisar guardar uma cópia do estado.
3. Antes de manutenção manual no JSON, gere backup.
4. Em conflitos de gravação, prefira mesclar/recarregar pelo fluxo da tela, evitando sobrescrever alterações de outra pessoa.

---

## 4. How to use por aba

### 4.1 Visão Geral

Use para responder: **“Como está a saúde do planejamento?”**

Principais usos:

- Ver total de recursos, recursos ativos, demandas totais e demandas abertas.
- Filtrar demandas por status, recurso, título e período.
- Avaliar distribuição de demandas por status.
- Acompanhar ocupação consolidada anual.
- Exportar gráficos em SVG/PNG quando disponível.
- Ver ranking/visão por recurso no mês.

Boas práticas:

- Comece a rotina diária pela Visão Geral.
- Se ocupação passar de 100%, abra Janelas Livres para localizar o gargalo.
- Se houver muitas demandas mapeadas, priorize atribuição de responsável.

### 4.2 Apontamentos

Use para responder: **“O realizado está aderente ao planejado?”**

Principais usos:

- Ver cards de demandas com métricas de execução.
- Identificar consumo acelerado, execução antecipada e execução fora do prazo.
- Comparar horas reais contra janela planejada.
- Priorizar demandas com baixa execução e prazo próximo.

Boas práticas:

- Não use apontamento como planejamento; apontamento é fato executado.
- Revise demandas sem apontamento quando já deveriam ter iniciado.
- Investigue toda execução fora do prazo.

### 4.3 Demandas

Use para responder: **“O que precisa ser feito, por quem e quando?”**

Principais usos:

- Cadastrar demandas.
- Atribuir múltiplos responsáveis.
- Definir horas/dia por responsável.
- Filtrar lista por status, responsável, título e datas.
- Editar, reprogramar, concluir, congelar e detalhar etapas.

Boas práticas:

- Use títulos padronizados: `Cliente/Sistema - Entrega - Complemento`.
- Não deixe demanda em andamento sem responsável.
- Reprograme prazo com justificativa em vez de editar datas sem contexto.
- Use **Mapeada** para backlog ainda não alocado.

### 4.4 Recursos

Use para responder: **“Quem existe no planejamento e qual capacidade possui?”**

Principais usos:

- Cadastrar recursos internos e terceiros.
- Controlar status ativo/inativo.
- Definir vigência de terceiros.
- Editar ou excluir recursos.

Boas práticas:

- Cadastre recursos antes das demandas.
- Inative em vez de excluir quando houver histórico relevante.
- Confira vigência de terceiros antes de planejar demandas futuras.

### 4.5 Bloqueio de Janela

Use para responder: **“Quais dias não têm capacidade?”**

Principais usos:

- Registrar bloqueios pontuais ou por período.
- Controlar feriados e indisponibilidades.
- Visualizar e remover bloqueios cadastrados.

Boas práticas:

- Bloqueie férias/ausências assim que conhecidas.
- Evite cadastrar demanda crítica em dia bloqueado.
- Após bloquear, valide a capacidade em Janelas Livres.

### 4.6 Horas Extras (HE)

Use para responder: **“Onde houve ou haverá esforço fora da jornada?”**

Principais usos:

- Registrar HE por recurso ou geral.
- Informar motivo obrigatório, prioridade, focal, prédio e observações.
- Excluir lançamentos indevidos.

Boas práticas:

- HE deve ser exceção, não capacidade padrão.
- Registre motivo objetivo: prazo regulatório, incidente, janela técnica, retrabalho etc.
- Compare HE com gargalos em Janelas Livres.

### 4.7 Janelas Livres

Use para responder: **“Onde posso encaixar uma nova demanda?”**

Principais usos:

- Ver heatmap mensal por recurso.
- Abrir drilldown diário por célula.
- Identificar dias com folga, ocupação parcial, ocupação cheia ou overcap.
- Entender impacto de bloqueios, feriados, férias/OFF e HE.

Boas práticas:

- Antes de assumir prazo novo, valide Janelas Livres.
- Prefira alocar demandas em recursos com folga contínua, não apenas um dia isolado.
- Se a janela estiver negativa, replaneje prazo, responsável ou escopo.

### 4.8 Lançamentos

Use para responder: **“Quais atividades foram realizadas hoje?”**

Principais usos:

- Registrar apontamentos de demandas.
- Registrar atividades internas sem demanda.
- Editar histórico recente.
- Classificar atividades como revisão, reunião, teste, correção, evidência, acompanhamento, suporte etc.

Boas práticas:

- Lance no mesmo dia sempre que possível.
- Diferencie demanda de atividade interna; isso evita distorcer indicadores de projeto.
- Use observações para explicar exceções.

### 4.9 Execução diária

Use para responder: **“Como foi a execução em uma data ou mês?”**

Principais usos:

- Ver execução por data.
- Avaliar demandas mensais.
- Acompanhar execução por recurso.
- Exportar CSV de execução diária.

Boas práticas:

- Use como fechamento diário/semanal.
- Compare esforço real com demandas planejadas.
- Trate divergências antes que virem atraso.

### 4.10 Sincronização de BD

Use para responder: **“Os dados estão seguros e sincronizados?”**

Principais usos:

- Conectar pasta ORIZONData/events.
- Selecionar BD JSON em modo leitura/gravação quando suportado.
- Importar/exportar snapshots.
- Exportar events JSONL.
- Resolver conflitos por mesclagem, recarga ou cópia.

Boas práticas:

- Fluxo recomendado: pasta ORIZONData com eventos.
- Não trabalhe por muito tempo com aviso de BD desconectado.
- Quando houver conflito, não sobrescreva sem revisar.
- Faça snapshot antes de grandes ajustes.

---

## 5. Cenários práticos avaliados

### Cenário A — Implantação inicial

1. Conectar ORIZONData.
2. Criar usuário.
3. Cadastrar recursos.
4. Cadastrar bloqueios/feriados conhecidos.
5. Cadastrar demandas mapeadas.
6. Atribuir responsáveis e horas/dia.
7. Conferir Visão Geral e Janelas Livres.
8. Exportar snapshot inicial.

Resultado esperado: capacidade base confiável e backlog visível.

### Cenário B — Nova demanda urgente

1. Criar demanda com prioridade Alta ou Crítica.
2. Abrir Janelas Livres para encontrar recurso com folga.
3. Validar impacto mensal na Visão Geral.
4. Se necessário, reprogramar demanda menos prioritária.
5. Registrar justificativa.

Resultado esperado: urgência acomodada sem ocultar overcap.

### Cenário C — Recurso terceiro com contrato vencendo

1. Cadastrar ou revisar vigência do terceiro em Recursos.
2. Conferir Janelas Livres após a data final.
3. Reprogramar demandas que ultrapassem a vigência.
4. Se houver extensão contratual, atualizar vigência.

Resultado esperado: planejamento não conta capacidade inexistente.

### Cenário D — Ausência/férias

1. Lançar bloqueio no período.
2. Conferir demandas impactadas no drilldown diário.
3. Reprogramar ou redistribuir responsáveis.
4. Verificar overcap na Visão Geral.

Resultado esperado: ausência refletida antes de virar atraso.

### Cenário E — Fechamento diário

1. Registrar apontamentos de demandas em Lançamentos.
2. Registrar atividades internas relevantes.
3. Ver Execução diária.
4. Corrigir apontamentos divergentes.
5. Exportar CSV se necessário.

Resultado esperado: realizado do dia registrado e auditável.

### Cenário F — Conflito de sincronização

1. Parar novas alterações locais.
2. Abrir Sincronização de BD.
3. Escolher mesclar quando houver alterações locais e remotas válidas.
4. Recarregar somente quando a versão remota for a fonte de verdade.
5. Exportar cópia quando houver dúvida.

Resultado esperado: menor risco de perda de dados.

---

## 6. Norte do usuário — regras de decisão

### 6.1 Antes de cadastrar uma demanda

Pergunte:

- Existe recurso com janela livre no período?
- A prioridade justifica deslocar outra demanda?
- A demanda já tem responsável ou ainda é mapeada?
- As datas são reais ou apenas desejo?
- A carga diária em horas é sustentável?

### 6.2 Quando a ocupação passar de 100%

Faça nesta ordem:

1. Verifique se há bloqueios/feriados indevidos.
2. Confira se horas/dia da demanda foram cadastradas corretamente.
3. Veja se há demanda mapeada que virou execução sem responsável correto.
4. Redistribua responsável ou reduza horas/dia.
5. Reprograme prazo com justificativa.
6. Use HE apenas se for decisão consciente e justificada.

### 6.3 Quando uma demanda atrasar

1. Confira apontamentos reais.
2. Identifique se o atraso é falta de capacidade, replanejamento não registrado ou execução abaixo do esperado.
3. Atualize status ou prazo com justificativa.
4. Se congelar, registre motivo.
5. Se concluir, garanta que a execução real esteja registrada.

### 6.4 Quando usar cada status

| Status | Use quando | Evite quando |
|---|---|---|
| Mapeada | Ainda não há responsável ou data/carga madura. | O trabalho já começou. |
| Em andamento | Há responsável e janela de execução ativa. | Não existe capacidade confirmada. |
| Congelada | Trabalho pausado por dependência, decisão ou impedimento. | É apenas baixa prioridade sem decisão formal. |
| Concluída | Entrega finalizada. | Ainda faltam apontamentos/validação. |
| Atrasada | O prazo passou e a demanda segue aberta. | O prazo foi formalmente reprogramado. |

### 6.5 Qual rotina seguir

**Diariamente**

- Registrar apontamentos e atividades internas.
- Conferir Execução diária.
- Verificar notificações e demandas atribuídas.

**Semanalmente**

- Revisar Visão Geral.
- Checar overcap e janelas livres.
- Atualizar bloqueios futuros.
- Reprogramar demandas com justificativa.

**Mensalmente**

- Revisar capacidade de recursos e vigências.
- Exportar pacote de análise.
- Validar demandas concluídas, congeladas e mapeadas.
- Gerar snapshot de segurança.

---

## 7. Checklist rápido

### Para gestor/coordenação

- [ ] BD/pasta ORIZONData conectado.
- [ ] Recursos ativos e vigências revisados.
- [ ] Bloqueios e feriados cadastrados.
- [ ] Demandas críticas sem overcap ou com plano de mitigação.
- [ ] Demandas mapeadas priorizadas.
- [ ] Exportação/snapshot gerado após grandes mudanças.

### Para executor/recurso

- [ ] Usuário definido.
- [ ] Demandas atribuídas revisadas.
- [ ] Apontamentos do dia lançados.
- [ ] Atividades internas registradas separadamente.
- [ ] Alertas de execução fora do prazo verificados.

### Para PMO/admin

- [ ] Sincronização sem conflito pendente.
- [ ] Backup antes de manutenção manual.
- [ ] Exportações CSV/Excel geradas para análise externa.
- [ ] Padrão de títulos, prioridades e status respeitado.

---

## 8. Glossário visual de interpretação

- **Folga alta:** bom candidato para nova alocação.
- **Folga parcial:** usar com cautela; demanda pequena ou baixa carga diária.
- **100% ocupado:** não adicionar sem remover/reprogramar algo.
- **Overcap:** existe mais trabalho planejado que capacidade disponível.
- **OFF/bloqueado:** não planejar execução nesse dia.
- **Execução antecipada:** houve apontamento antes da data planejada.
- **Execução fora do prazo:** houve apontamento depois do prazo atual.
- **Consumo acelerado:** real consumindo horas mais rápido que a janela planejada.

---

## 9. Resultado esperado do uso correto

Ao seguir este norte, o usuário deve conseguir:

1. Saber quem está disponível.
2. Saber quais demandas estão abertas, atrasadas, congeladas, mapeadas ou concluídas.
3. Enxergar gargalos antes do prazo estourar.
4. Registrar execução real com rastreabilidade.
5. Preservar histórico por snapshots/eventos.
6. Tomar decisão de priorização com base em capacidade, não em percepção.
