require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

// ─────────────────────────────────────────────
// init: seed default bank profiles if empty
// ─────────────────────────────────────────────
async function initDatabase() {
    console.log('--- Verificando conexão com Supabase ---');

    const { count, error } = await supabase
        .from('bank_profiles')
        .select('*', { count: 'exact', head: true });

    if (error) {
        console.error('Erro ao conectar ao Supabase:', error.message);
        return;
    }

    if (count === 0) {
        await supabase.from('bank_profiles').insert([
            { nome: 'C6 Bank', identificador: 'C6', palavras_ignorar: 'Cartao final,Cartão final,C6 Invest,C6 Bank', cartao_final: '2623' },
            { nome: 'Ourocard / BB', identificador: 'Ourocard', palavras_ignorar: 'Ourocard Visa,Banco do Brasil,Pagar fatura,Compras a vista', cartao_final: '' }
        ]);
        console.log('--- Perfis bancários padrão inseridos ---');
    }

    console.log('--- Conexão com Supabase OK ---');
}

// ─────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────
async function getSettings() {
    const { data, error } = await supabase.from('settings').select('*');
    if (error) throw error;
    return data;
}

async function getSetting(key) {
    const { data, error } = await supabase.from('settings').select('value').eq('key', key).single();
    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows found
    return data ? data.value : null;
}

async function updateSetting(key, value) {
    const { error } = await supabase.from('settings').upsert({ key, value }, { onConflict: 'key' });
    if (error) throw error;
}

// ─────────────────────────────────────────────
// Transactions
// ─────────────────────────────────────────────
async function getRows() {
    const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .order('id', { ascending: false });
    if (error) throw error;
    return data.map(mapRow);
}

async function saveTransactionsToDb(transactions) {
    const rows = transactions.map(t => ({
        data:           t['Data'],
        mes:            t['Mês'],
        descricao:      t['Descrição'],
        tipo:           t['Tipo'],
        tipo_pagamento: t['Tipo de Pagamento'],
        parcela:        t['Parcela'],
        banco_cartao:   t['Banco/Cartão'],
        categoria:      t['Categoria'],
        valor:          t['Valor (R$)']
    }));

    const { error } = await supabase.from('transactions').insert(rows);
    if (error) {
        console.error('Erro ao salvar no Supabase:', error.message);
        throw error;
    }
    console.log(`--- ${transactions.length} transações salvas no Supabase ---`);
}

async function updateTransactionInDb(id, t) {
    const { error } = await supabase.from('transactions').update({
        data:           t['Data'],
        mes:            t['Mês'],
        descricao:      t['Descrição'],
        tipo:           t['Tipo'],
        tipo_pagamento: t['Tipo de Pagamento'],
        parcela:        t['Parcela'],
        banco_cartao:   t['Banco/Cartão'],
        categoria:      t['Categoria'],
        valor:          t['Valor (R$)']
    }).eq('id', id);
    if (error) throw error;
}

async function deleteTransactionFromDb(id) {
    const { error } = await supabase.from('transactions').delete().eq('id', id);
    if (error) throw error;
}

// ─────────────────────────────────────────────
// Suppliers
// ─────────────────────────────────────────────
async function getSuppliers() {
    const { data, error } = await supabase.from('suppliers').select('*').order('nome', { ascending: true });
    if (error) throw error;
    return data;
}

async function addSupplier(nome, categoria) {
    const { error } = await supabase.from('suppliers').insert({ nome, categoria });
    if (error) throw error;
}

async function updateSupplier(id, nome, categoria) {
    const { error } = await supabase.from('suppliers').update({ nome, categoria }).eq('id', id);
    if (error) throw error;
}

async function deleteSupplierFromDb(id) {
    const { error } = await supabase.from('suppliers').delete().eq('id', id);
    if (error) throw error;
}

// ─────────────────────────────────────────────
// Bank Profiles
// ─────────────────────────────────────────────
async function getBankProfiles() {
    const { data, error } = await supabase.from('bank_profiles').select('*').order('nome', { ascending: true });
    if (error) throw error;
    return data;
}

async function addBankProfile(nome, identificador, palavras_ignorar, cartao_final) {
    const { error } = await supabase.from('bank_profiles').insert({ nome, identificador, palavras_ignorar, cartao_final });
    if (error) throw error;
}

async function updateBankProfile(id, nome, identificador, palavras_ignorar, cartao_final) {
    const { error } = await supabase.from('bank_profiles').update({ nome, identificador, palavras_ignorar, cartao_final }).eq('id', id);
    if (error) throw error;
}

async function deleteBankProfile(id) {
    const { error } = await supabase.from('bank_profiles').delete().eq('id', id);
    if (error) throw error;
}

// ─────────────────────────────────────────────
// Helper: mapeamento de nome de coluna → chave de exibição
// ─────────────────────────────────────────────
function mapRow(row) {
    return {
        id: row.id,
        'Data':             row.data,
        'Mês':              row.mes,
        'Descrição':        row.descricao,
        'Tipo':             row.tipo,
        'Tipo de Pagamento': row.tipo_pagamento,
        'Parcela':          row.parcela,
        'Banco/Cartão':     row.banco_cartao,
        'Categoria':        row.categoria,
        'Valor (R$)':       row.valor
    };
}

module.exports = {
    initDatabase,
    getRows,
    saveTransactionsToDb,
    updateTransactionInDb,
    deleteTransactionFromDb,
    getSuppliers,
    addSupplier,
    updateSupplier,
    deleteSupplierFromDb,
    getSettings,
    getSetting,
    updateSetting,
    getBankProfiles,
    addBankProfile,
    updateBankProfile,
    deleteBankProfile
};
