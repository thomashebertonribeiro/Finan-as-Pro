'use strict';

const { createClient } = require('@supabase/supabase-js');

// Contador em memória de tentativas falhas por compromisso
const failureCount = new Map();
const MAX_FAILURES = 3;

function formatDateTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
}

async function checkAndSendReminders(supabaseGlobal, sendMessageFn) {
  try {
    const now = new Date();

    const { data: appointments, error } = await supabaseGlobal
      .from('appointments')
      .select('*')
      .eq('cancelado', false)
      .is('reminder_sent_at', null);

    if (error) { console.error('❌ [SCHEDULER] Erro ao buscar compromissos:', error.message); return; }
    if (!appointments || appointments.length === 0) return;

    const pending = appointments.filter((appt) => {
      const dataHora = new Date(appt.data_hora);
      const lembreteMs = (appt.lembrete_minutos || 15) * 60 * 1000;
      return dataHora >= now && dataHora <= new Date(now.getTime() + lembreteMs);
    });

    for (const appt of pending) {
      const apptId = appt.id;
      if ((failureCount.get(apptId) || 0) >= MAX_FAILURES) continue;

      const { data: settings, error: settingsError } = await supabaseGlobal
        .from('settings').select('value')
        .eq('key', 'whatsapp_authorized_number')
        .eq('user_id', appt.user_id).single();

      if (settingsError || !settings?.value) {
        console.warn(`⚠️ [SCHEDULER] Número não configurado para user_id=${appt.user_id}`);
        continue;
      }

      const numero = settings.value.trim();
      const descricao = appt.descricao ? `\n📝 ${appt.descricao}` : '';
      const mensagem = `🔔 *Lembrete de compromisso*\n\n📌 *${appt.titulo}*\n🕐 ${formatDateTime(appt.data_hora)}${descricao}`;

      try {
        await sendMessageFn(numero, mensagem);
        await supabaseGlobal.from('appointments').update({ reminder_sent_at: new Date().toISOString() }).eq('id', apptId);
        console.log(`✅ [SCHEDULER] Lembrete enviado — ${appt.titulo}`);
        failureCount.delete(apptId);
      } catch (sendError) {
        failureCount.set(apptId, (failureCount.get(apptId) || 0) + 1);
        console.error(`❌ [SCHEDULER] Falha ao enviar lembrete:`, sendError.message);
      }
    }
  } catch (err) {
    console.error('❌ [SCHEDULER] Erro inesperado:', err.message);
  }
}

function startScheduler(supabaseGlobal, waService) {
  const client = supabaseGlobal || createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const sendMessageFn = waService?.sendMessage
    ? (numero, msg) => waService.sendMessage(numero, msg)
    : () => Promise.resolve();

  console.log('🕐 [SCHEDULER] Iniciado — verificando lembretes a cada 60 segundos.');
  setInterval(() => checkAndSendReminders(client, sendMessageFn), 60000);
}

module.exports = { startScheduler, checkAndSendReminders };
