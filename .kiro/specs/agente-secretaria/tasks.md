# Plano de Implementação: Agente Secretaria

## Visão Geral

Implementação incremental do módulo de gerenciamento de compromissos pessoais integrado à plataforma Finanças Pro. Cada tarefa constrói sobre a anterior, terminando com a integração completa entre banco de dados, backend, agente WhatsApp e interface web.

## Tarefas

- [x] 1. Criar migration SQL da tabela `appointments`
  - Criar o arquivo `migration_appointments.sql` com a definição completa da tabela
  - Incluir campos: `id`, `user_id`, `titulo`, `data_hora`, `descricao`, `lembrete_minutos`, `recorrencia`, `recorrencia_grupo_id`, `cancelado`, `reminder_sent_at`, `created_at`
  - Adicionar constraint CHECK para `recorrencia IN ('unica', 'semanal', 'mensal')`
  - Habilitar RLS e criar policy `users_own_appointments` usando `auth.uid() = user_id`
  - Criar índices: `idx_appointments_user_data_hora` e `idx_appointments_reminder` (parcial, WHERE cancelado = false AND reminder_sent_at IS NULL)
  - _Requirements: 1.1, 1.2, 10.1_

- [x] 2. Implementar `server/appointment-service.js`
  - [x] 2.1 Implementar `generateRecurrences(baseAppointment, recorrencia)`
    - Gerar array de 12 objetos adicionais com mesmo `recorrencia_grupo_id` (UUID v4)
    - Para `semanal`: incrementar 7 dias por ocorrência
    - Para `mensal`: incrementar 1 mês preservando o dia original; usar último dia válido quando o dia não existir no mês destino (ex: 31 de fevereiro → 28/29)
    - _Requirements: 1.3, 7.1, 7.2, 7.3, 7.4_

  - [ ]* 2.2 Escrever teste de propriedade para `generateRecurrences` — recorrência semanal
    - **Property 4: Recorrência semanal gera exatamente 13 registros**
    - **Validates: Requirements 1.3, 7.1**
    - `// Feature: agente-secretaria, Property 4: recorrência semanal gera 13 registros`

  - [ ]* 2.3 Escrever teste de propriedade para `generateRecurrences` — recorrência mensal
    - **Property 5: Recorrência mensal preserva dia ou usa último dia válido**
    - **Validates: Requirements 7.2, 7.4**
    - `// Feature: agente-secretaria, Property 5: recorrência mensal preserva dia`

  - [x] 2.4 Implementar `createAppointment(supabase, userId, payload)`
    - Validar que `titulo` não é vazio/apenas espaços — lançar erro descritivo se inválido
    - Validar que `data_hora` é uma string ISO 8601 válida
    - Chamar `generateRecurrences` se `recorrencia !== 'unica'`
    - Inserir todos os registros no Supabase via `supabase.from('appointments').insert(rows)`
    - Retornar array de compromissos criados
    - _Requirements: 1.1, 1.3, 1.4, 3.1, 9.1_

  - [ ]* 2.5 Escrever teste de propriedade para `createAppointment` — título vazio
    - **Property 3: Título vazio é rejeitado**
    - **Validates: Requirements 1.4**
    - `// Feature: agente-secretaria, Property 3: título vazio é rejeitado`

  - [x] 2.6 Implementar `getAppointments(supabase, userId, { start, end })`
    - Consultar `appointments` filtrando por `user_id`, `cancelado = false`
    - Aplicar filtro de `data_hora` entre `start` e `end` quando fornecidos
    - Ordenar por `data_hora` ascendente
    - _Requirements: 4.1, 9.2_

  - [x] 2.7 Implementar `updateAppointment(supabase, userId, id, fields)`
    - Atualizar apenas os campos fornecidos no payload
    - Garantir que o `user_id` do registro corresponde ao solicitante (RLS cobre, mas verificar retorno)
    - _Requirements: 9.3_

  - [x] 2.8 Implementar `cancelAppointment(supabase, userId, id, cancelar_serie)`
    - Se `cancelar_serie = false`: marcar apenas o registro com `id` como `cancelado = true`
    - Se `cancelar_serie = true`: buscar `recorrencia_grupo_id` do registro e marcar todos os registros futuros da série como `cancelado = true`
    - Nunca deletar registros — apenas atualizar o campo `cancelado`
    - _Requirements: 5.2, 5.5, 8.4, 8.5, 9.4_

  - [ ]* 2.9 Escrever teste de propriedade para `cancelAppointment`
    - **Property 6: Cancelamento não apaga, apenas marca**
    - **Validates: Requirements 5.2, 8.4**
    - `// Feature: agente-secretaria, Property 6: cancelamento marca sem apagar`

  - [x] 2.10 Implementar `resolveUserIdByPhone(supabaseGlobal, phoneNumber)`
    - Buscar em `settings` onde `key = 'whatsapp_authorized_number'` e comparar os últimos 8 dígitos do número
    - Retornar `user_id` correspondente ou `null` se não encontrado
    - _Requirements: 10.2, 10.3, 10.4_

- [ ] 3. Checkpoint — Testar appointment-service isoladamente
  - Garantir que todos os testes passam, perguntar ao usuário se houver dúvidas.

- [x] 4. Estender `server/gemini-service.js` com `processAppointmentMessage`
  - [x] 4.1 Implementar `processAppointmentMessage(text, contextDate)`
    - Criar prompt para o Gemini classificar a intenção como `criar | consultar | editar | cancelar | outro`
    - Para `criar`: extrair `titulo`, `data_hora` (ISO 8601), `descricao`, `lembrete_minutos`, `recorrencia`
    - Para `consultar`: extrair `periodo.start` e `periodo.end` (ISO 8601)
    - Para `editar`/`cancelar`: extrair `alvo.titulo` e/ou `alvo.data_hora` e `campos_editar`
    - Incluir `contextDate` no prompt para resolver datas relativas ("amanhã", "próxima sexta")
    - Retornar `null` se a API key não estiver configurada
    - Exportar a função no `module.exports`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ]* 4.2 Escrever teste de propriedade para `processAppointmentMessage`
    - **Property 8: NLP extrai intent de criação**
    - **Validates: Requirements 2.1, 2.2**
    - `// Feature: agente-secretaria, Property 8: NLP extrai intent de criação`

- [x] 5. Estender `server/whatsapp-service.js` com roteamento de agenda
  - [x] 5.1 Adicionar `handleAppointmentIntent(sock, jid, userId, supabase, intent, dados)` no arquivo
    - Para `criar`: chamar `appointmentService.createAppointment` e responder com confirmação (título, data, hora, lembrete)
    - Para `consultar`: chamar `appointmentService.getAppointments` e formatar lista; responder "nenhum compromisso" se vazio; paginar em blocos de 10 se mais de 10 itens
    - Para `cancelar`: apresentar dados do compromisso encontrado e armazenar em `pendingConfirmations` aguardando "Sim"/"Não"; perguntar sobre série se recorrente
    - Para `editar`: apresentar dados atuais e campos a alterar, aguardar confirmação
    - _Requirements: 3.2, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 5.2 Modificar `handleTextMessage` para rotear intenções de agenda
    - Antes do fluxo financeiro existente, chamar `processAppointmentMessage(text)`
    - Se `intent !== 'outro'`: resolver `userId` via `resolveUserIdByPhone`, criar cliente Supabase com token de serviço e chamar `handleAppointmentIntent`
    - Se `intent === 'outro'` ou `processAppointmentMessage` retornar `null`: continuar para o fluxo financeiro existente sem alteração
    - Se `resolveUserIdByPhone` retornar `null`: logar aviso e ignorar a mensagem
    - _Requirements: 2.6, 10.3, 10.4_

- [x] 6. Adicionar endpoints REST `/appointments` em `server/index.js`
  - [x] 6.1 Registrar `POST /appointments`
    - Validar body: `titulo` obrigatório, `data_hora` obrigatório
    - Chamar `appointmentService.createAppointment(req.supabase, req.userId, req.body)`
    - Retornar HTTP 201 com array de compromissos criados
    - Retornar HTTP 400 com mensagem descritiva se validação falhar
    - _Requirements: 9.1, 9.5_

  - [x] 6.2 Registrar `GET /appointments`
    - Aceitar query params `start` e `end` (ISO 8601 opcionais)
    - Chamar `appointmentService.getAppointments(req.supabase, req.userId, { start, end })`
    - Retornar HTTP 200 com array
    - _Requirements: 9.2, 9.5_

  - [x] 6.3 Registrar `PUT /appointments/:id`
    - Chamar `appointmentService.updateAppointment(req.supabase, req.userId, req.params.id, req.body)`
    - Retornar HTTP 200 com compromisso atualizado
    - _Requirements: 9.3, 9.5_

  - [x] 6.4 Registrar `DELETE /appointments/:id`
    - Aceitar query param `cancelar_serie` (booleano, padrão false)
    - Chamar `appointmentService.cancelAppointment(req.supabase, req.userId, req.params.id, cancelar_serie)`
    - Retornar HTTP 200 com mensagem de confirmação
    - _Requirements: 9.4, 9.5_

  - [ ]* 6.5 Escrever teste de propriedade para endpoints sem JWT
    - **Property 9: Endpoint sem JWT retorna 401**
    - **Validates: Requirements 9.5**
    - `// Feature: agente-secretaria, Property 9: endpoint sem JWT retorna 401`

  - [x] 6.6 Carregar `appointment-service.js` no bloco de inicialização de módulos
    - Adicionar `appointmentService = require('./appointment-service')` junto aos outros módulos
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [ ] 7. Checkpoint — Testar endpoints REST com cliente HTTP
  - Garantir que todos os testes passam, perguntar ao usuário se houver dúvidas.

- [x] 8. Implementar `server/scheduler.js`
  - [x] 8.1 Implementar `checkAndSendReminders(supabaseGlobal, sendMessageFn)`
    - Buscar compromissos onde `cancelado = false`, `reminder_sent_at IS NULL` e `data_hora` está entre `now()` e `now() + lembrete_minutos`
    - Para cada compromisso: buscar o número autorizado do usuário via `settings`
    - Chamar `sendMessageFn(numero, mensagem)` com título, data, hora e descrição
    - Atualizar `reminder_sent_at = now()` após envio bem-sucedido
    - Se WhatsApp não estiver conectado: manter `reminder_sent_at = null` e incrementar contador de tentativas em memória; desistir após 3 tentativas
    - Se número não configurado: registrar log de aviso e pular
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 8.2 Implementar `startScheduler(supabaseGlobal, waService)`
    - Usar `setInterval` de 60.000ms chamando `checkAndSendReminders`
    - Exportar `startScheduler`
    - _Requirements: 6.1_

  - [ ]* 8.3 Escrever teste de propriedade para o scheduler
    - **Property 7: Lembrete não é enviado duas vezes**
    - **Validates: Requirements 6.3**
    - `// Feature: agente-secretaria, Property 7: lembrete não duplicado`

  - [x] 8.4 Inicializar o scheduler em `server/index.js`
    - Carregar `scheduler = require('./scheduler')` no bloco de módulos
    - Chamar `scheduler.startScheduler(supabaseGlobal, waService)` após `waService.connectToWhatsApp()`
    - _Requirements: 6.1_

- [x] 9. Implementar aba Agenda em `client/src/App.jsx`
  - [x] 9.1 Adicionar estado e funções de agenda
    - Adicionar estados: `appointments`, `calendarMonth`, `calendarYear`, `selectedDay`, `showAppointmentModal`
    - Adicionar `appointmentForm` com campos: `titulo`, `data`, `hora`, `descricao`, `lembrete_minutos` (padrão 15), `recorrencia` (padrão 'unica')
    - Implementar `fetchAppointments(start, end)` chamando `GET /appointments`
    - Implementar `createAppointment()` chamando `POST /appointments`
    - Implementar `cancelAppointment(id, cancelar_serie)` chamando `DELETE /appointments/:id`
    - _Requirements: 8.1, 8.3, 8.4, 9.1, 9.2, 9.4_

  - [x] 9.2 Implementar componente de calendário mensal (grid puro, sem bibliotecas externas)
    - Calcular o primeiro dia da semana do mês e o total de dias usando `new Date(year, month, 0).getDate()` e `new Date(year, month - 1, 1).getDay()`
    - Renderizar grid de 7 colunas (Dom–Sáb) com células vazias para os dias antes do dia 1
    - Destacar o dia atual com estilo diferenciado
    - Exibir ponto/badge nos dias que possuem compromissos
    - Clicar em um dia define `selectedDay` e filtra a lista abaixo
    - Botões `<` e `>` para navegar entre meses, atualizando `calendarMonth`/`calendarYear` e chamando `fetchAppointments`
    - _Requirements: 8.2_

  - [x] 9.3 Implementar lista de compromissos e modal de criação
    - Exibir compromissos do `selectedDay` (ou do mês inteiro se nenhum dia selecionado), ordenados por hora
    - Cada item mostra: hora, título, descrição (se houver), badge de recorrência (`semanal`/`mensal`)
    - Botão "Cancelar" por item com `window.confirm`; se recorrente, perguntar sobre série
    - Botão "Novo compromisso" abre modal com formulário
    - Modal pré-preenche `data` com `selectedDay` se definido
    - Ao submeter o formulário, combinar `data` + `hora` em ISO 8601 e chamar `createAppointment()`
    - _Requirements: 8.1, 8.3, 8.4, 8.5_

  - [x] 9.4 Adicionar botão "Agenda" na sidebar e conectar aba
    - Inserir `<button>` na `<nav>` da sidebar com ícone `calendar_month` e texto "Agenda"
    - Renderizar `<AgendaTab />` quando `activeTab === 'agenda'`
    - Chamar `fetchAppointments` ao entrar na aba (via `useEffect` dependente de `activeTab`)
    - _Requirements: 8.6_

- [ ] 10. Checkpoint final — Garantir integração completa
  - Garantir que todos os testes passam, perguntar ao usuário se houver dúvidas.

- [ ] 11. Testes de propriedade de isolamento multi-tenant e persistência
  - [ ]* 11.1 Escrever teste de propriedade — isolamento multi-tenant
    - **Property 1: Isolamento multi-tenant**
    - **Validates: Requirements 10.1, 10.2, 9.6**
    - `// Feature: agente-secretaria, Property 1: isolamento multi-tenant`

  - [ ]* 11.2 Escrever teste de propriedade — criação persiste e é recuperável
    - **Property 2: Criação persiste e é recuperável**
    - **Validates: Requirements 3.1, 9.1, 9.2**
    - `// Feature: agente-secretaria, Property 2: criação persiste e é recuperável`

## Notas

- Tarefas marcadas com `*` são opcionais e podem ser puladas para um MVP mais rápido
- Cada tarefa referencia os requisitos específicos para rastreabilidade
- O calendário mensal usa apenas JavaScript nativo — sem `date-fns`, `dayjs` ou similares
- O scheduler usa `setInterval` de 60s e o cliente Supabase global para varrer todos os usuários
- A coluna `reminder_sent_at` evita duplicatas de lembrete sem necessidade de tabela auxiliar
- O roteamento de intenção no WhatsApp é não-destrutivo: se `intent === 'outro'`, o fluxo financeiro existente continua sem alteração
