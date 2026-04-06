# Plano de Implementação: Multi-Tenant (Fase 1 — Isolamento por Usuário)

## Visão Geral

Implementação incremental em 5 etapas: script SQL de migração → auth middleware → database.js com userId → rotas protegidas no Express → interceptor axios no frontend.

## Tarefas

- [x] 1. Criar script SQL de migração (`migration.sql`)
  - Criar o arquivo `migration.sql` na raiz do projeto
  - Adicionar `ALTER TABLE ... ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id)` para as 4 tabelas: `transactions`, `suppliers`, `bank_profiles`, `settings`
  - Adicionar bloco `DO $$ ... END $$` que busca o primeiro usuário em `auth.users ORDER BY created_at ASC LIMIT 1` e faz `UPDATE ... SET user_id = first_user_id WHERE user_id IS NULL` nas 4 tabelas; se nenhum usuário existir, emite `RAISE NOTICE` e retorna sem alterar dados
  - Após o bloco de migração, adicionar `ALTER TABLE ... ALTER COLUMN user_id SET NOT NULL, ALTER COLUMN user_id SET DEFAULT auth.uid()` para as 4 tabelas
  - Adicionar `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` para as 4 tabelas
  - Criar políticas RLS para SELECT, INSERT, UPDATE e DELETE em cada tabela usando `user_id = auth.uid()`
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.4, 6.1, 6.2, 6.3, 6.4_

  - [ ]* 1.1 Escrever teste de propriedade para idempotência da migração
    - **Property 7: Idempotência do script de migração**
    - Executar o script duas vezes e verificar que o estado final é idêntico e sem erros
    - **Validates: Requirements 1.4**

- [x] 2. Implementar `server/authMiddleware.js`
  - Criar o arquivo `server/authMiddleware.js`
  - Importar `jsonwebtoken` e `@supabase/supabase-js`
  - Ler `SUPABASE_JWT_SECRET`, `SUPABASE_URL` e `SUPABASE_ANON_KEY` de `process.env`; se `SUPABASE_JWT_SECRET` não estiver definido, lançar erro crítico no boot
  - Implementar `function authMiddleware(req, res, next)`:
    - Extrair token do header `Authorization: Bearer <token>`; se ausente, retornar `401 { error: "Token de autenticação ausente" }`
    - Verificar o token com `jwt.verify(token, SUPABASE_JWT_SECRET)`; se expirado, retornar `401 { error: "Token expirado. Faça login novamente." }`; se inválido, retornar `401 { error: "Token inválido" }`
    - Extrair `payload.sub` como `userId` e atribuir a `req.userId`
    - Criar `userSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: \`Bearer \${token}\` } } })` e atribuir a `req.supabase`
    - Chamar `next()`
  - Exportar `authMiddleware`
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ]* 2.1 Escrever testes unitários para `authMiddleware`
    - Testar: token ausente → 401 "Token de autenticação ausente"
    - Testar: token malformado → 401 "Token inválido"
    - Testar: token expirado → 401 "Token expirado. Faça login novamente."
    - Testar: token válido → `req.userId` igual ao `sub` do payload, `req.supabase` instanciado
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ]* 2.2 Escrever teste de propriedade para rejeição de tokens inválidos
    - **Property 4: Middleware rejeita tokens inválidos**
    - Gerar strings aleatórias, tokens com assinatura incorreta e tokens expirados; verificar que todos retornam 401
    - **Validates: Requirements 4.1, 4.3, 4.4**

  - [ ]* 2.3 Escrever teste de propriedade para extração correta do user_id
    - **Property 5: Extração correta do user_id**
    - Gerar UUIDs aleatórios, criar JWTs válidos com esses UUIDs como `sub`, verificar que o middleware extrai o mesmo UUID em `req.userId`
    - **Validates: Requirements 4.2**

- [ ] 3. Checkpoint — Verificar middleware antes de prosseguir
  - Garantir que todos os testes do middleware passam, perguntar ao usuário se há dúvidas antes de continuar.

- [x] 4. Atualizar `server/database.js` para receber `supabase` e `userId`
  - Remover o cliente Supabase global (instância única criada no topo do arquivo); manter apenas `initDatabase` usando o cliente global para seed inicial
  - Atualizar a assinatura de todas as funções para receber `(supabase, userId)` como primeiros parâmetros:
    - `getRows(supabase, userId)` — adicionar `.eq('user_id', userId)` na query SELECT
    - `saveTransactionsToDb(supabase, userId, transactions)` — incluir `user_id: userId` em cada objeto inserido; usar o `supabase` recebido
    - `autoRegisterSuppliers(supabase, userId, transactions)` — incluir `user_id: userId` nos inserts; usar o `supabase` recebido
    - `updateTransactionInDb(supabase, userId, id, t)` — adicionar `.eq('user_id', userId)` junto ao `.eq('id', id)`
    - `deleteTransactionFromDb(supabase, userId, id)` — adicionar `.eq('user_id', userId)` junto ao `.eq('id', id)`
    - `getSuppliers(supabase, userId)` — adicionar `.eq('user_id', userId)`
    - `addSupplier(supabase, userId, nome, categoria)` — incluir `user_id: userId` no insert
    - `updateSupplier(supabase, userId, id, nome, categoria)` — adicionar `.eq('user_id', userId)`
    - `deleteSupplierFromDb(supabase, userId, id)` — adicionar `.eq('user_id', userId)`
    - `getSettings(supabase, userId)` — adicionar `.eq('user_id', userId)`
    - `getSetting(supabase, userId, key)` — adicionar `.eq('user_id', userId)`
    - `updateSetting(supabase, userId, key, value)` — incluir `user_id: userId` no upsert com `onConflict: 'key,user_id'`
    - `getBankProfiles(supabase, userId)` — adicionar `.eq('user_id', userId)`
    - `addBankProfile(supabase, userId, nome, identificador, palavras_ignorar, cartao_final)` — incluir `user_id: userId`
    - `updateBankProfile(supabase, userId, id, nome, identificador, palavras_ignorar, cartao_final)` — adicionar `.eq('user_id', userId)`
    - `deleteBankProfile(supabase, userId, id)` — adicionar `.eq('user_id', userId)`
  - Atualizar `getMonthlySummary` para receber e usar `(supabase, userId)` ao chamar `getRows`
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 4.1 Escrever teste de propriedade para isolamento de leitura
    - **Property 1: Isolamento de leitura por usuário**
    - Gerar dois UUIDs distintos, inserir N registros para cada um, consultar com cada userId e verificar que os conjuntos são disjuntos
    - **Validates: Requirements 2.2, 5.1**

  - [ ]* 4.2 Escrever teste de propriedade para user_id preservado no INSERT
    - **Property 2: user_id preservado no INSERT**
    - Gerar UUID aleatório + dados de transação aleatórios, inserir via `saveTransactionsToDb`, consultar e verificar que `user_id` do registro é igual ao `userId` passado
    - **Validates: Requirements 5.2**

  - [ ]* 4.3 Escrever teste de propriedade para isolamento de escrita
    - **Property 3: Isolamento de escrita (UPDATE e DELETE)**
    - Gerar dois usuários, inserir registros para o usuário A, tentar UPDATE/DELETE com userId do usuário B, verificar que o registro permanece inalterado
    - **Validates: Requirements 5.3, 5.4, 5.5**

- [x] 5. Aplicar `authMiddleware` nas rotas protegidas em `server/index.js`
  - Importar `authMiddleware` de `./authMiddleware`
  - Aplicar `authMiddleware` como middleware nas seguintes rotas (antes dos handlers existentes):
    - `POST /process-image`
    - `POST /save-transactions`
    - `GET /dashboard-stats`
    - `GET /transactions`, `PUT /transactions/:id`, `DELETE /transactions/:id`
    - `GET /suppliers`, `POST /suppliers`, `PUT /suppliers/:id`, `DELETE /suppliers/:id`
    - `GET /settings`, `POST /settings`
    - `GET /bank-profiles`, `POST /bank-profiles`, `PUT /bank-profiles/:id`, `DELETE /bank-profiles/:id`
  - NÃO aplicar middleware nas rotas: `GET /`, `GET /health`, `GET /whatsapp-status`, `GET /whatsapp-qr`, `GET /whatsapp-start`, `POST /whatsapp-logout`, `GET /ai-logs`, `DELETE /ai-logs`
  - Atualizar todos os handlers das rotas protegidas para passar `req.supabase` e `req.userId` nas chamadas a `db.*`:
    - Ex: `db.getRows()` → `db.getRows(req.supabase, req.userId)`
    - Ex: `db.saveTransactionsToDb(transactions)` → `db.saveTransactionsToDb(req.supabase, req.userId, transactions)`
    - Aplicar o mesmo padrão para todas as outras chamadas de db nas rotas protegidas
  - Na rota `POST /process-image`, passar `req.supabase` e `req.userId` para `db.getSuppliers`
  - _Requirements: 4.5, 4.6_

  - [ ]* 5.1 Escrever testes unitários para rotas protegidas vs. públicas
    - Testar que rotas protegidas retornam 401 sem token
    - Testar que rotas de saúde (`/`, `/health`, `/whatsapp-status`) respondem sem token
    - _Requirements: 4.5, 4.6_

- [ ] 6. Checkpoint — Verificar backend completo
  - Garantir que todos os testes do backend passam, perguntar ao usuário se há dúvidas antes de continuar.

- [x] 7. Adicionar interceptor axios no `client/src/App.jsx`
  - Localizar o `useEffect` inicial (onde `supabase.auth.getSession` e `supabase.auth.onAuthStateChange` são chamados)
  - Dentro desse `useEffect`, após configurar o listener de auth, registrar um interceptor axios global:
    ```js
    const interceptorId = axios.interceptors.request.use(async (config) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        config.headers.Authorization = `Bearer ${session.access_token}`;
      }
      return config;
    });
    ```
  - No cleanup do `useEffect` (função de retorno), ejetar o interceptor: `axios.interceptors.request.eject(interceptorId)`
  - Garantir que o interceptor é registrado apenas uma vez (dentro do `useEffect` com array de dependências vazio `[]`)
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ]* 7.1 Escrever teste de propriedade para envio do token pelo frontend
    - **Property 6: Frontend sempre envia token em rotas protegidas**
    - Mockar `supabase.auth.getSession()` com tokens aleatórios, interceptar chamadas axios e verificar presença do header `Authorization: Bearer <token>`
    - **Validates: Requirements 3.1, 3.2**

- [x] 8. Adicionar `SUPABASE_JWT_SECRET` ao arquivo de exemplo de variáveis de ambiente
  - Editar `server/.env.example` e adicionar a linha: `SUPABASE_JWT_SECRET=<valor do painel Supabase → Settings → API → JWT Secret>`
  - _Requirements: 4.1_

- [ ] 9. Checkpoint final — Garantir que tudo está integrado
  - Garantir que todos os testes passam, perguntar ao usuário se há dúvidas antes de finalizar.

## Notas

- Tarefas marcadas com `*` são opcionais e podem ser puladas para um MVP mais rápido
- O script `migration.sql` deve ser executado manualmente no SQL Editor do Supabase antes de subir o backend atualizado
- A variável `SUPABASE_JWT_SECRET` deve ser adicionada ao painel do Railway (Variables) antes do deploy
- As rotas do WhatsApp não são protegidas intencionalmente — o isolamento para transações via WhatsApp será tratado na Fase 2
- O cliente Supabase global em `database.js` é mantido apenas para `initDatabase` (seed de perfis bancários padrão)
