# Requirements Document

## Introduction

O Agente Secretaria é uma nova funcionalidade da plataforma Finanças Pro que transforma o sistema em uma plataforma de agentes pessoais. O agente gerencia compromissos e agenda do usuário, permitindo criar, consultar, editar e cancelar compromissos via mensagens de texto natural no WhatsApp (processadas pelo Gemini) e por uma interface web de agenda. O sistema envia lembretes automáticos via WhatsApp antes dos compromissos e suporta recorrência semanal e mensal. Todo o isolamento de dados segue o modelo multi-tenant existente (user_id + RLS do Supabase).

## Glossary

- **Agente_Secretaria**: Módulo do sistema responsável por gerenciar compromissos do usuário via WhatsApp e interface web.
- **Compromisso**: Registro de evento agendado contendo título, data, hora, descrição opcional, configuração de lembrete e tipo de recorrência.
- **Recorrência**: Propriedade de um compromisso que define se ele se repete: `unica`, `semanal` ou `mensal`.
- **Lembrete**: Notificação enviada via WhatsApp X minutos antes do horário do compromisso.
- **Scheduler**: Processo em background no servidor que verifica periodicamente compromissos próximos e dispara lembretes.
- **NLP_Parser**: Componente que utiliza o Google Gemini para interpretar mensagens de texto natural e extrair intenção e dados de compromissos.
- **Agenda_View**: Página da interface web que exibe compromissos do usuário em formato de lista e/ou calendário.
- **Intent**: Intenção detectada pelo NLP_Parser a partir de uma mensagem do usuário: `criar`, `consultar`, `editar`, `cancelar` ou `outro`.

---

## Requirements

### Requirement 1: Estrutura de Dados do Compromisso

**User Story:** Como usuário, quero que meus compromissos armazenem todas as informações necessárias, para que eu possa gerenciá-los com precisão.

#### Acceptance Criteria

1. THE Agente_Secretaria SHALL armazenar cada compromisso com os campos: `id`, `user_id`, `titulo`, `data_hora` (timestamp com timezone), `descricao` (opcional), `lembrete_minutos` (inteiro, padrão 15), `recorrencia` (enum: `unica`, `semanal`, `mensal`), `cancelado` (booleano, padrão false) e `created_at`.
2. THE Agente_Secretaria SHALL associar cada compromisso a um `user_id` válido, garantindo isolamento multi-tenant via Row Level Security do Supabase.
3. WHEN um compromisso recorrente é criado, THE Agente_Secretaria SHALL gerar automaticamente as próximas 12 ocorrências a partir da data original.
4. IF o campo `titulo` estiver ausente ou vazio ao criar um compromisso, THEN THE Agente_Secretaria SHALL retornar um erro descritivo sem salvar o registro.

---

### Requirement 2: Interpretação de Mensagens via WhatsApp

**User Story:** Como usuário, quero enviar mensagens de texto natural pelo WhatsApp para gerenciar meus compromissos, para que eu não precise aprender comandos específicos.

#### Acceptance Criteria

1. WHEN uma mensagem de texto é recebida pelo WhatsApp de um número autorizado, THE NLP_Parser SHALL classificar a intenção da mensagem como `criar`, `consultar`, `editar`, `cancelar` ou `outro`.
2. WHEN a intenção classificada é `criar`, THE NLP_Parser SHALL extrair do texto: título do compromisso, data, hora, descrição (se mencionada), minutos de lembrete (se mencionado) e recorrência (se mencionada).
3. WHEN a intenção classificada é `consultar`, THE NLP_Parser SHALL extrair o período de consulta (ex: "amanhã", "esta semana", "sexta-feira") e retornar os compromissos correspondentes do usuário.
4. WHEN a intenção classificada é `cancelar`, THE NLP_Parser SHALL extrair o identificador do compromisso (título e/ou data) e solicitar confirmação antes de cancelar.
5. WHEN a intenção classificada é `editar`, THE NLP_Parser SHALL extrair o compromisso alvo e os campos a alterar, e solicitar confirmação antes de aplicar a edição.
6. WHEN a intenção classificada é `outro` e não se relaciona a compromissos, THE Agente_Secretaria SHALL encaminhar a mensagem ao fluxo financeiro existente sem interrupção.
7. IF o NLP_Parser não conseguir extrair data ou hora de uma mensagem de criação, THEN THE Agente_Secretaria SHALL responder ao usuário solicitando a informação faltante.

---

### Requirement 3: Criação de Compromissos via WhatsApp

**User Story:** Como usuário, quero criar compromissos enviando uma mensagem pelo WhatsApp, para que eu possa agendar eventos de forma rápida.

#### Acceptance Criteria

1. WHEN o NLP_Parser extrai dados válidos de criação, THE Agente_Secretaria SHALL salvar o compromisso no banco de dados associado ao `user_id` do número autorizado.
2. WHEN um compromisso é salvo com sucesso, THE Agente_Secretaria SHALL responder ao usuário via WhatsApp com uma confirmação contendo: título, data, hora e configuração de lembrete.
3. WHEN o usuário menciona lembrete na mensagem (ex: "me avisa 30 minutos antes"), THE NLP_Parser SHALL extrair o valor em minutos e armazená-lo no campo `lembrete_minutos`.
4. WHEN o usuário menciona recorrência na mensagem (ex: "toda semana", "todo mês"), THE NLP_Parser SHALL definir o campo `recorrencia` como `semanal` ou `mensal` respectivamente.
5. IF a data extraída for anterior à data e hora atuais, THEN THE Agente_Secretaria SHALL alertar o usuário e solicitar confirmação antes de salvar.

---

### Requirement 4: Consulta de Compromissos via WhatsApp

**User Story:** Como usuário, quero consultar meus compromissos pelo WhatsApp, para que eu saiba o que tenho agendado sem precisar abrir o aplicativo.

#### Acceptance Criteria

1. WHEN o usuário solicita compromissos de um período específico, THE Agente_Secretaria SHALL retornar via WhatsApp a lista de compromissos não cancelados do usuário naquele período, ordenados por `data_hora` ascendente.
2. WHEN nenhum compromisso é encontrado para o período consultado, THE Agente_Secretaria SHALL responder ao usuário informando que não há compromissos agendados para o período.
3. WHILE a lista de compromissos retornada contiver mais de 10 itens, THE Agente_Secretaria SHALL paginar a resposta em blocos de 10, informando ao usuário que há mais compromissos disponíveis.

---

### Requirement 5: Cancelamento de Compromissos via WhatsApp

**User Story:** Como usuário, quero cancelar compromissos pelo WhatsApp, para que eu possa gerenciar minha agenda sem abrir o aplicativo.

#### Acceptance Criteria

1. WHEN o usuário solicita o cancelamento de um compromisso, THE Agente_Secretaria SHALL identificar o compromisso pelo título e/ou data e apresentar os dados ao usuário para confirmação.
2. WHEN o usuário confirma o cancelamento, THE Agente_Secretaria SHALL marcar o campo `cancelado` como `true` no banco de dados e responder com confirmação.
3. WHEN o usuário nega o cancelamento, THE Agente_Secretaria SHALL responder informando que a operação foi abortada sem alterar nenhum dado.
4. IF nenhum compromisso correspondente for encontrado para o critério de cancelamento informado, THEN THE Agente_Secretaria SHALL responder ao usuário informando que o compromisso não foi localizado.
5. WHEN o compromisso cancelado possui recorrência, THE Agente_Secretaria SHALL perguntar ao usuário se deseja cancelar apenas a ocorrência específica ou todas as ocorrências futuras.

---

### Requirement 6: Lembretes Automáticos via WhatsApp

**User Story:** Como usuário, quero receber lembretes automáticos no WhatsApp antes dos meus compromissos, para que eu não esqueça eventos importantes.

#### Acceptance Criteria

1. THE Scheduler SHALL verificar a cada 1 minuto os compromissos não cancelados cujo `data_hora` esteja dentro de `lembrete_minutos` minutos a partir do momento atual.
2. WHEN um compromisso está dentro da janela de lembrete, THE Scheduler SHALL enviar uma mensagem WhatsApp ao número autorizado do usuário contendo: título, data, hora e descrição do compromisso.
3. THE Scheduler SHALL registrar cada lembrete enviado para evitar o envio duplicado do mesmo lembrete para o mesmo compromisso.
4. IF o número autorizado do usuário não estiver configurado, THEN THE Scheduler SHALL registrar um log de aviso e não tentar enviar a mensagem.
5. IF o WhatsApp não estiver conectado no momento do envio do lembrete, THEN THE Scheduler SHALL registrar o lembrete como pendente e tentar reenviar nas próximas 3 verificações.

---

### Requirement 7: Recorrência de Compromissos

**User Story:** Como usuário, quero que compromissos recorrentes gerem automaticamente as próximas ocorrências, para que eu não precise recriá-los manualmente.

#### Acceptance Criteria

1. WHEN um compromisso com `recorrencia = semanal` é criado, THE Agente_Secretaria SHALL gerar 12 ocorrências adicionais com intervalo de 7 dias a partir da data original.
2. WHEN um compromisso com `recorrencia = mensal` é criado, THE Agente_Secretaria SHALL gerar 12 ocorrências adicionais com intervalo de 1 mês a partir da data original, preservando o dia do mês original.
3. THE Agente_Secretaria SHALL vincular todas as ocorrências de uma série recorrente por meio de um campo `recorrencia_grupo_id` (UUID compartilhado entre as ocorrências da mesma série).
4. IF o dia do mês original não existir em um mês de destino (ex: dia 31 em fevereiro), THEN THE Agente_Secretaria SHALL usar o último dia válido do mês de destino para aquela ocorrência.

---

### Requirement 8: Interface Web — Página de Agenda

**User Story:** Como usuário, quero visualizar meus compromissos em uma página web, para que eu tenha uma visão clara da minha agenda.

#### Acceptance Criteria

1. THE Agenda_View SHALL exibir os compromissos do usuário autenticado em uma lista ordenada por `data_hora` ascendente, mostrando: título, data, hora, descrição (se houver) e status (ativo/cancelado).
2. THE Agenda_View SHALL permitir filtrar compromissos por período (hoje, esta semana, este mês, personalizado).
3. THE Agenda_View SHALL permitir ao usuário criar um novo compromisso por meio de um formulário com os campos: título (obrigatório), data (obrigatório), hora (obrigatório), descrição (opcional), lembrete em minutos (padrão 15) e recorrência (padrão `unica`).
4. THE Agenda_View SHALL permitir ao usuário cancelar um compromisso diretamente pela interface, com confirmação antes da ação.
5. WHEN o usuário cancela um compromisso recorrente pela interface, THE Agenda_View SHALL perguntar se deseja cancelar apenas a ocorrência selecionada ou todas as ocorrências futuras da série.
6. THE Agenda_View SHALL ser acessível como uma nova aba na navegação lateral do sistema, identificada como "Agenda".

---

### Requirement 9: API REST de Compromissos

**User Story:** Como desenvolvedor, quero endpoints REST para gerenciar compromissos, para que o frontend e o agente WhatsApp possam interagir com os dados de forma padronizada.

#### Acceptance Criteria

1. THE Agente_Secretaria SHALL expor o endpoint `POST /appointments` para criar um compromisso, aceitando: `titulo`, `data_hora`, `descricao`, `lembrete_minutos` e `recorrencia`.
2. THE Agente_Secretaria SHALL expor o endpoint `GET /appointments` para listar compromissos do usuário autenticado, com suporte a parâmetros de filtro `start` e `end` (datas ISO 8601).
3. THE Agente_Secretaria SHALL expor o endpoint `PUT /appointments/:id` para editar um compromisso existente do usuário autenticado.
4. THE Agente_Secretaria SHALL expor o endpoint `DELETE /appointments/:id` para cancelar um compromisso, aceitando o parâmetro `cancelar_serie` (booleano) para cancelamento em série.
5. IF uma requisição a qualquer endpoint de compromissos não contiver um token JWT válido, THEN THE Agente_Secretaria SHALL retornar HTTP 401 sem processar a operação.
6. IF uma requisição tentar acessar ou modificar um compromisso pertencente a outro `user_id`, THEN THE Agente_Secretaria SHALL retornar HTTP 403.

---

### Requirement 10: Isolamento Multi-Tenant

**User Story:** Como usuário, quero que meus compromissos sejam completamente isolados dos de outros usuários, para que minha privacidade seja garantida.

#### Acceptance Criteria

1. THE Agente_Secretaria SHALL aplicar Row Level Security (RLS) na tabela `appointments` do Supabase, restringindo todas as operações ao `user_id` do usuário autenticado.
2. THE Agente_Secretaria SHALL associar o número de WhatsApp autorizado ao `user_id` por meio da tabela `settings` existente, usando a chave `whatsapp_authorized_number`.
3. WHEN uma mensagem WhatsApp é recebida, THE Agente_Secretaria SHALL identificar o `user_id` correspondente ao número remetente antes de executar qualquer operação de compromisso.
4. IF nenhum `user_id` for encontrado para o número remetente de uma mensagem WhatsApp, THEN THE Agente_Secretaria SHALL ignorar a mensagem sem processar nem responder.
