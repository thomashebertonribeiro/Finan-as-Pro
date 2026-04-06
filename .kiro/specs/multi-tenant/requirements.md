# Requirements Document

## Introduction

Esta feature transforma o Finanças Pro em um sistema multi-tenant na Fase 1: isolamento de dados por usuário. Atualmente, o backend não valida o usuário autenticado e todas as tabelas do Supabase (transactions, suppliers, bank_profiles, settings) não possuem coluna `user_id`, permitindo que qualquer usuário acesse todos os dados. O objetivo é garantir que cada usuário veja e manipule apenas seus próprios dados, sem alterar a experiência de uso.

## Glossary

- **Sistema**: O backend Node.js/Express do Finanças Pro
- **Frontend**: A aplicação React/Vite em `client/src`
- **Supabase**: O banco de dados PostgreSQL gerenciado usado pelo sistema
- **JWT**: JSON Web Token emitido pelo Supabase Auth após autenticação bem-sucedida
- **user_id**: Identificador único do usuário autenticado, extraído do JWT (campo `sub`)
- **RLS**: Row Level Security — mecanismo do PostgreSQL/Supabase que restringe acesso a linhas por política
- **Auth_Middleware**: Middleware Express responsável por validar o JWT e extrair o `user_id`
- **Tenant**: Um usuário isolado com seus próprios dados no sistema
- **Dados_Legados**: Registros existentes nas tabelas antes da implementação do multi-tenant

## Requirements

### Requirement 1: Adição de user_id nas tabelas do banco de dados

**User Story:** Como administrador do sistema, quero que todas as tabelas do Supabase possuam uma coluna `user_id`, para que os dados possam ser associados e isolados por usuário.

#### Acceptance Criteria

1. THE Sistema SHALL adicionar a coluna `user_id` do tipo `uuid` nas tabelas `transactions`, `suppliers`, `bank_profiles` e `settings`
2. THE Sistema SHALL definir a coluna `user_id` como NOT NULL com default `auth.uid()` nas tabelas após a migração dos dados legados
3. WHEN dados legados existem nas tabelas, THE Sistema SHALL associar esses registros ao `user_id` do primeiro usuário cadastrado no `auth.users`
4. IF a coluna `user_id` já existir em uma tabela, THEN THE Sistema SHALL ignorar a operação de adição para essa tabela sem gerar erro

---

### Requirement 2: Configuração de Row Level Security (RLS)

**User Story:** Como administrador do sistema, quero que o Supabase aplique RLS em todas as tabelas, para que o banco de dados rejeite automaticamente acessos não autorizados a nível de linha.

#### Acceptance Criteria

1. THE Sistema SHALL habilitar RLS nas tabelas `transactions`, `suppliers`, `bank_profiles` e `settings`
2. WHEN RLS está habilitado, THE Supabase SHALL permitir operações SELECT, INSERT, UPDATE e DELETE somente para linhas onde `user_id = auth.uid()`
3. WHEN uma requisição chega sem um JWT válido do Supabase, THE Supabase SHALL rejeitar o acesso retornando erro de autorização
4. THE Sistema SHALL criar políticas RLS separadas para cada operação (SELECT, INSERT, UPDATE, DELETE) em cada tabela

---

### Requirement 3: Envio do JWT pelo Frontend

**User Story:** Como usuário autenticado, quero que o frontend envie meu token de autenticação em cada requisição ao backend, para que o servidor possa identificar quem sou e filtrar meus dados corretamente.

#### Acceptance Criteria

1. WHEN o usuário está autenticado, THE Frontend SHALL incluir o header `Authorization: Bearer <token>` em todas as requisições HTTP ao backend
2. WHEN a sessão do Supabase é renovada automaticamente, THE Frontend SHALL usar o token atualizado nas requisições subsequentes
3. WHEN o usuário não está autenticado, THE Frontend SHALL redirecionar para a tela de login sem enviar requisições ao backend
4. THE Frontend SHALL obter o token JWT através de `supabase.auth.getSession()` antes de cada requisição

---

### Requirement 4: Validação do JWT e extração do user_id no Backend

**User Story:** Como administrador do sistema, quero que o backend valide o JWT em cada requisição e extraia o `user_id`, para que todas as queries ao banco sejam filtradas pelo usuário correto.

#### Acceptance Criteria

1. THE Auth_Middleware SHALL validar o token JWT presente no header `Authorization` de cada requisição protegida
2. WHEN o JWT é válido, THE Auth_Middleware SHALL extrair o `user_id` do campo `sub` do payload e disponibilizá-lo em `req.userId`
3. IF o header `Authorization` estiver ausente ou o token for inválido, THEN THE Auth_Middleware SHALL retornar HTTP 401 com mensagem de erro descritiva
4. IF o token JWT estiver expirado, THEN THE Auth_Middleware SHALL retornar HTTP 401 com mensagem indicando expiração
5. THE Sistema SHALL aplicar o Auth_Middleware em todas as rotas de dados: `/transactions`, `/suppliers`, `/bank-profiles`, `/settings`, `/dashboard-stats`, `/save-transactions`, `/process-image`
6. THE Sistema SHALL excluir do Auth_Middleware as rotas de saúde: `/`, `/health`, `/whatsapp-status`, `/whatsapp-qr`, `/whatsapp-start`, `/whatsapp-logout`

---

### Requirement 5: Filtragem de queries por user_id no Backend

**User Story:** Como usuário autenticado, quero que todas as operações de banco de dados sejam filtradas pelo meu `user_id`, para que eu veja e manipule apenas meus próprios dados.

#### Acceptance Criteria

1. WHEN o backend executa uma query SELECT, THE Sistema SHALL incluir o filtro `.eq('user_id', userId)` em todas as consultas às tabelas `transactions`, `suppliers`, `bank_profiles` e `settings`
2. WHEN o backend insere um novo registro, THE Sistema SHALL incluir o campo `user_id` com o valor extraído do JWT em todos os INSERTs
3. WHEN o backend atualiza um registro, THE Sistema SHALL incluir o filtro `.eq('user_id', userId)` junto ao filtro de `id` para garantir que o usuário só atualize seus próprios registros
4. WHEN o backend exclui um registro, THE Sistema SHALL incluir o filtro `.eq('user_id', userId)` junto ao filtro de `id` para garantir que o usuário só exclua seus próprios registros
5. IF um usuário tentar acessar um registro de outro usuário via ID, THEN THE Sistema SHALL retornar HTTP 404 sem revelar a existência do registro

---

### Requirement 6: Migração de dados legados

**User Story:** Como administrador do sistema, quero que os dados existentes sejam associados ao primeiro usuário cadastrado, para que o histórico financeiro não seja perdido durante a migração.

#### Acceptance Criteria

1. THE Sistema SHALL fornecer um script SQL de migração que associe todos os registros sem `user_id` ao `id` do primeiro usuário em `auth.users` ordenado por `created_at`
2. WHEN o script de migração é executado, THE Sistema SHALL atualizar os registros nas tabelas `transactions`, `suppliers`, `bank_profiles` e `settings`
3. WHEN o script de migração é executado em um banco vazio (sem usuários), THE Sistema SHALL registrar um aviso e não executar nenhuma atualização
4. THE Sistema SHALL fornecer o script de migração como arquivo `.sql` executável diretamente no SQL Editor do Supabase
