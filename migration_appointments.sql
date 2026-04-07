-- Migration: tabela appointments
-- Spec: agente-secretaria
-- Requirements: 1.1, 1.2, 10.1

CREATE TABLE appointments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  titulo               TEXT NOT NULL,
  data_hora            TIMESTAMPTZ NOT NULL,
  descricao            TEXT,
  lembrete_minutos     INTEGER NOT NULL DEFAULT 15,
  recorrencia          TEXT NOT NULL DEFAULT 'unica'
                         CHECK (recorrencia IN ('unica', 'semanal', 'mensal')),
  recorrencia_grupo_id UUID,
  cancelado            BOOLEAN NOT NULL DEFAULT false,
  reminder_sent_at     TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_appointments" ON appointments
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_appointments_user_data_hora ON appointments(user_id, data_hora);

CREATE INDEX idx_appointments_reminder ON appointments(data_hora, cancelado, reminder_sent_at)
  WHERE cancelado = false AND reminder_sent_at IS NULL;
