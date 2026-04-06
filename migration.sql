-- =============================================================================
-- Multi-Tenant Migration Script — Fase 1: Isolamento por Usuário
-- Requisitos: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.4, 6.1, 6.2, 6.3, 6.4
-- Execute no SQL Editor do Supabase
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PASSO 1: Adicionar coluna user_id nas 4 tabelas (idempotente com IF NOT EXISTS)
-- Req 1.1, 1.4
-- -----------------------------------------------------------------------------
ALTER TABLE transactions   ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
ALTER TABLE suppliers      ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
ALTER TABLE bank_profiles  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);
ALTER TABLE settings       ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);

-- -----------------------------------------------------------------------------
-- PASSO 2: Migrar dados legados para o primeiro usuário cadastrado
-- Req 1.3, 6.1, 6.2, 6.3
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  first_user_id uuid;
BEGIN
  SELECT id INTO first_user_id FROM auth.users ORDER BY created_at ASC LIMIT 1;

  IF first_user_id IS NULL THEN
    RAISE NOTICE 'Nenhum usuário encontrado. Migração de dados legados não executada.';
    RETURN;
  END IF;

  UPDATE transactions  SET user_id = first_user_id WHERE user_id IS NULL;
  UPDATE suppliers     SET user_id = first_user_id WHERE user_id IS NULL;
  UPDATE bank_profiles SET user_id = first_user_id WHERE user_id IS NULL;
  UPDATE settings      SET user_id = first_user_id WHERE user_id IS NULL;

  RAISE NOTICE 'Migração concluída. Dados legados associados ao user_id: %', first_user_id;
END $$;

-- -----------------------------------------------------------------------------
-- PASSO 3: Tornar user_id NOT NULL e definir default auth.uid()
-- Req 1.2
-- -----------------------------------------------------------------------------
ALTER TABLE transactions   ALTER COLUMN user_id SET NOT NULL, ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE suppliers      ALTER COLUMN user_id SET NOT NULL, ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE bank_profiles  ALTER COLUMN user_id SET NOT NULL, ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE settings       ALTER COLUMN user_id SET NOT NULL, ALTER COLUMN user_id SET DEFAULT auth.uid();

-- -----------------------------------------------------------------------------
-- PASSO 4: Habilitar Row Level Security nas 4 tabelas
-- Req 2.1
-- -----------------------------------------------------------------------------
ALTER TABLE transactions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings       ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- PASSO 5: Políticas RLS — transactions
-- Req 2.2, 2.4
-- -----------------------------------------------------------------------------
CREATE POLICY "transactions_select" ON transactions
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "transactions_insert" ON transactions
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "transactions_update" ON transactions
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "transactions_delete" ON transactions
  FOR DELETE USING (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- PASSO 5: Políticas RLS — suppliers
-- Req 2.2, 2.4
-- -----------------------------------------------------------------------------
CREATE POLICY "suppliers_select" ON suppliers
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "suppliers_insert" ON suppliers
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "suppliers_update" ON suppliers
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "suppliers_delete" ON suppliers
  FOR DELETE USING (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- PASSO 5: Políticas RLS — bank_profiles
-- Req 2.2, 2.4
-- -----------------------------------------------------------------------------
CREATE POLICY "bank_profiles_select" ON bank_profiles
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "bank_profiles_insert" ON bank_profiles
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "bank_profiles_update" ON bank_profiles
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "bank_profiles_delete" ON bank_profiles
  FOR DELETE USING (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- PASSO 5: Políticas RLS — settings
-- Req 2.2, 2.4
-- -----------------------------------------------------------------------------
CREATE POLICY "settings_select" ON settings
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "settings_insert" ON settings
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "settings_update" ON settings
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "settings_delete" ON settings
  FOR DELETE USING (user_id = auth.uid());
