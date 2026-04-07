'use strict';

const { randomUUID } = require('crypto');

/**
 * Gera 12 ocorrências adicionais de um compromisso recorrente.
 * Retorna array com o base + 12 ocorrências (13 total).
 *
 * @param {object} baseAppointment - Compromisso base (já com recorrencia_grupo_id)
 * @param {'semanal'|'mensal'} recorrencia
 * @returns {object[]}
 */
function generateRecurrences(baseAppointment, recorrencia) {
  const occurrences = [baseAppointment];
  const grupoId = baseAppointment.recorrencia_grupo_id;

  const baseDate = new Date(baseAppointment.data_hora);
  const originalDay = baseDate.getUTCDate();

  for (let i = 1; i <= 12; i++) {
    let nextDate;

    if (recorrencia === 'semanal') {
      nextDate = new Date(baseDate);
      nextDate.setUTCDate(baseDate.getUTCDate() + 7 * i);
    } else {
      // mensal: avança i meses preservando o dia original
      nextDate = new Date(baseDate);
      const targetMonth = baseDate.getUTCMonth() + i;
      const targetYear = baseDate.getUTCFullYear() + Math.floor(targetMonth / 12);
      const normalizedMonth = targetMonth % 12;

      // Último dia do mês destino
      const lastDayOfMonth = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
      const day = Math.min(originalDay, lastDayOfMonth);

      nextDate = new Date(Date.UTC(
        targetYear,
        normalizedMonth,
        day,
        baseDate.getUTCHours(),
        baseDate.getUTCMinutes(),
        baseDate.getUTCSeconds(),
        baseDate.getUTCMilliseconds()
      ));
    }

    occurrences.push({
      ...baseAppointment,
      id: undefined, // será gerado pelo Supabase
      data_hora: nextDate.toISOString(),
      recorrencia_grupo_id: grupoId,
    });
  }

  return occurrences;
}

/**
 * Cria um ou mais compromissos no Supabase.
 *
 * @param {object} supabase - Cliente Supabase autenticado
 * @param {string} userId
 * @param {object} params
 * @param {string} params.titulo
 * @param {string} params.data_hora - ISO 8601
 * @param {string} [params.descricao]
 * @param {number} [params.lembrete_minutos=15]
 * @param {'unica'|'semanal'|'mensal'} [params.recorrencia='unica']
 * @returns {Promise<object[]>}
 */
async function createAppointment(supabase, userId, { titulo, data_hora, descricao, lembrete_minutos = 15, recorrencia = 'unica' }) {
  // Validações
  if (!titulo || titulo.trim() === '') {
    throw new Error('O campo título é obrigatório e não pode estar vazio.');
  }

  if (!data_hora || isNaN(Date.parse(data_hora))) {
    throw new Error('O campo data_hora deve ser uma string ISO 8601 válida.');
  }

  const grupoId = randomUUID();

  const base = {
    user_id: userId,
    titulo: titulo.trim(),
    data_hora,
    descricao: descricao || null,
    lembrete_minutos,
    recorrencia,
    recorrencia_grupo_id: recorrencia !== 'unica' ? grupoId : null,
    cancelado: false,
  };

  let rows;
  if (recorrencia !== 'unica') {
    const all = generateRecurrences(base, recorrencia);
    // Remove o campo id undefined para deixar o Supabase gerar
    rows = all.map(({ id, ...rest }) => rest);
  } else {
    const { id, ...rest } = base;
    rows = [rest];
  }

  const { data, error } = await supabase
    .from('appointments')
    .insert(rows)
    .select();

  if (error) throw error;
  return data;
}

/**
 * Lista compromissos ativos do usuário, com filtro opcional por período.
 *
 * @param {object} supabase
 * @param {string} userId
 * @param {object} [params]
 * @param {string} [params.start] - ISO 8601
 * @param {string} [params.end]   - ISO 8601
 * @returns {Promise<object[]>}
 */
async function getAppointments(supabase, userId, { start, end } = {}) {
  let query = supabase
    .from('appointments')
    .select('*')
    .eq('user_id', userId)
    .eq('cancelado', false)
    .order('data_hora', { ascending: true });

  if (start) {
    query = query.gte('data_hora', start);
  }
  if (end) {
    query = query.lte('data_hora', end);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/**
 * Atualiza campos de um compromisso do usuário.
 *
 * @param {object} supabase
 * @param {string} userId
 * @param {string} id - UUID do compromisso
 * @param {object} fields - Campos a atualizar
 * @returns {Promise<object>}
 */
async function updateAppointment(supabase, userId, id, fields) {
  const { data, error } = await supabase
    .from('appointments')
    .update(fields)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Cancela um compromisso (ou toda a série futura).
 *
 * @param {object} supabase
 * @param {string} userId
 * @param {string} id - UUID do compromisso
 * @param {boolean} [cancelar_serie=false]
 * @returns {Promise<void>}
 */
async function cancelAppointment(supabase, userId, id, cancelar_serie = false) {
  if (!cancelar_serie) {
    const { error } = await supabase
      .from('appointments')
      .update({ cancelado: true })
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw error;
    return;
  }

  // Busca o registro para obter recorrencia_grupo_id e data_hora
  const { data: record, error: fetchError } = await supabase
    .from('appointments')
    .select('recorrencia_grupo_id, data_hora')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (fetchError) throw fetchError;

  const { recorrencia_grupo_id, data_hora } = record;

  if (!recorrencia_grupo_id) {
    // Sem série, cancela apenas o registro
    const { error } = await supabase
      .from('appointments')
      .update({ cancelado: true })
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw error;
    return;
  }

  // Cancela este e todos os futuros da mesma série
  const { error } = await supabase
    .from('appointments')
    .update({ cancelado: true })
    .eq('recorrencia_grupo_id', recorrencia_grupo_id)
    .eq('user_id', userId)
    .gte('data_hora', data_hora);

  if (error) throw error;
}

/**
 * Resolve o user_id a partir de um número de telefone WhatsApp.
 * Compara os últimos 8 dígitos do número com o valor salvo em settings.
 *
 * @param {object} supabaseGlobal - Cliente Supabase global (sem contexto de usuário)
 * @param {string} phoneNumber - Número do remetente (ex: "5511999999999@s.whatsapp.net")
 * @returns {Promise<string|null>} user_id ou null
 */
async function resolveUserIdByPhone(supabaseGlobal, phoneNumber) {
  if (!supabaseGlobal || !phoneNumber) return null;

  // Extrai apenas dígitos do número recebido
  const digits = phoneNumber.replace(/\D/g, '');
  const last8 = digits.slice(-8);

  const { data, error } = await supabaseGlobal
    .from('settings')
    .select('user_id, value')
    .in('key', ['whatsapp_authorized_number', 'whatsapp_lid']);

  if (error || !data || data.length === 0) return null;

  for (const row of data) {
    const savedDigits = (row.value || '').replace(/\D/g, '');
    // Compara últimos 8 dígitos (número de telefone) ou valor exato (LID)
    if (savedDigits.slice(-8) === last8 || row.value === digits) {
      return row.user_id;
    }
  }

  return null;
}

module.exports = {
  generateRecurrences,
  createAppointment,
  getAppointments,
  updateAppointment,
  cancelAppointment,
  resolveUserIdByPhone,
};
