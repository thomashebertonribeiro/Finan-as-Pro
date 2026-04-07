require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ ERRO CRÍTICO: Variáveis de ambiente SUPABASE_URL ou SUPABASE_ANON_KEY não encontradas!');
    console.error('Certifique-se de que elas estão configuradas no Painel do Railway (Variables) ou no arquivo .env');
}

// Cliente global usado apenas para initDatabase (seed inicial, sem contexto de usuário)
const supabaseGlobal = (supabaseUrl && supabaseKey)
    ? createClient(supabaseUrl, supabaseKey)
    : null;

// ─────────────────────────────────────────────
// init: seed default bank profiles if empty
// ─────────────────────────────────────────────
async function initDatabase() {
    if (!supabaseGlobal) return;
    console.log('--- Verificando conexão com Supabase ---');

    const { count, error } = await supabaseGlobal
        .from('bank_profiles')
        .select('*', { count: 'exact', head: true });

    if (error) {
        console.error('Erro ao conectar ao Supabase:', error.message);
        return;
    }

    if (count === 0) {
        await supabaseGlobal.from('bank_profiles').insert([
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
async function getSettings(supabase, userId) {
    if (!supabase) return [];
    const { data, error } = await supabase
        .from('settings')
        .select('*')
        .eq('user_id', userId);
    if (error) throw error;
    return data;
}

async function getSetting(supabase, userId, key) {
    if (!supabase) return null;
    const { data, error } = await supabase
        .from('settings')
        .select('value')
        .eq('key', key)
        .eq('user_id', userId)
        .single();
    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows found
    return data ? data.value : null;
}

async function updateSetting(supabase, userId, key, value) {
    if (!supabase) throw new Error("Supabase não configurado. Verifique as variáveis de ambiente.");
    const { error } = await supabase
        .from('settings')
        .upsert({ key, value, user_id: userId }, { onConflict: 'key,user_id' });
    if (error) throw error;
}

// ─────────────────────────────────────────────
// Transactions
// ─────────────────────────────────────────────
async function getRows(supabase, userId) {
    if (!supabase) return [];
    const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .order('id', { ascending: false });
    if (error) throw error;
    return data.map(mapRow);
}

async function saveTransactionsToDb(supabase, userId, transactions) {
    if (!supabase) throw new Error("Supabase não configurado.");

    // Busca lançamentos existentes para deduplicação
    const existing = await getRows(supabase, userId);
    const existingKeys = new Set(
        existing.map(r => `${(r['Descrição'] || '').toLowerCase().trim()}|${r['Data']}|${String(r['Valor (R$)'] || '').trim()}`)
    );

    const unique = transactions.filter(t => {
        const key = `${(t['Descrição'] || '').toLowerCase().trim()}|${t['Data']}|${String(t['Valor (R$)'] || '').trim()}`;
        return !existingKeys.has(key);
    });

    const skipped = transactions.length - unique.length;
    if (skipped > 0) console.log(`--- ${skipped} lançamento(s) duplicado(s) ignorado(s) ---`);
    if (unique.length === 0) {
        console.log('--- Nenhum lançamento novo para salvar ---');
        return [];
    }

    const rows = unique.map(t => ({
        data:           t['Data'],
        mes:            t['Mês'],
        descricao:      t['Descrição'],
        tipo:           t['Tipo'],
        tipo_pagamento: t['Tipo de Pagamento'],
        parcela:        t['Parcela'],
        banco_cartao:   t['Banco/Cartão'],
        categoria:      t['Categoria'],
        valor:          t['Valor (R$)'],
        user_id:        userId
    }));

    const { error } = await supabase.from('transactions').insert(rows);
    if (error) {
        console.error('Erro ao salvar no Supabase:', error.message);
        throw error;
    }
    console.log(`--- ${unique.length} transações salvas no Supabase ---`);

    // Auto-registra fornecedores novos
    const newSuppliers = await autoRegisterSuppliers(supabase, userId, unique);
    return newSuppliers;
}

// ─────────────────────────────────────────────
// Auto-register suppliers from transactions
// ─────────────────────────────────────────────
async function autoRegisterSuppliers(supabase, userId, transactions) {
    if (!supabase) return [];
    const existing = await getSuppliers(supabase, userId);
    const existingNames = new Set(existing.map(s => s.nome.toLowerCase().trim()));

    const toInsert = [];
    const seen = new Set();

    for (const t of transactions) {
        const nome = (t['Descrição'] || '').trim();
        const categoria = t['Categoria'] || 'Outros';
        // Ignora entradas, lançamentos sem descrição ou já existentes
        if (!nome || t['Tipo'] === 'Entrada') continue;
        const key = nome.toLowerCase();
        if (existingNames.has(key) || seen.has(key)) continue;
        seen.add(key);
        toInsert.push({ nome, categoria, user_id: userId });
    }

    if (toInsert.length > 0) {
        const { error } = await supabase.from('suppliers').insert(toInsert);
        if (error) console.error('Erro ao auto-registrar fornecedores:', error.message);
        else console.log(`--- ${toInsert.length} fornecedor(es) auto-registrado(s) ---`);
    }

    return toInsert;
}

async function updateTransactionInDb(supabase, userId, id, t) {
    if (!supabase) throw new Error("Supabase não configurado.");
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
    }).eq('id', id).eq('user_id', userId);
    if (error) throw error;
}

async function deleteTransactionFromDb(supabase, userId, id) {
    if (!supabase) throw new Error("Supabase não configurado.");
    const { error } = await supabase
        .from('transactions')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);
    if (error) throw error;
}

// ─────────────────────────────────────────────
// Suppliers
// ─────────────────────────────────────────────
async function getSuppliers(supabase, userId) {
    if (!supabase) return [];
    const { data, error } = await supabase
        .from('suppliers')
        .select('*')
        .eq('user_id', userId)
        .order('nome', { ascending: true });
    if (error) throw error;
    return data;
}

async function addSupplier(supabase, userId, nome, categoria) {
    if (!supabase) throw new Error("Supabase não configurado.");
    const { error } = await supabase
        .from('suppliers')
        .insert({ nome, categoria, user_id: userId });
    if (error) throw error;
}

async function updateSupplier(supabase, userId, id, nome, categoria) {
    if (!supabase) throw new Error("Supabase não configurado.");
    const { error } = await supabase
        .from('suppliers')
        .update({ nome, categoria })
        .eq('id', id)
        .eq('user_id', userId);
    if (error) throw error;
}

async function deleteSupplierFromDb(supabase, userId, id) {
    if (!supabase) throw new Error("Supabase não configurado.");
    const { error } = await supabase
        .from('suppliers')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);
    if (error) throw error;
}

// ─────────────────────────────────────────────
// Bank Profiles
// ─────────────────────────────────────────────
async function getBankProfiles(supabase, userId) {
    if (!supabase) return [];
    const { data, error } = await supabase
        .from('bank_profiles')
        .select('*')
        .eq('user_id', userId)
        .order('nome', { ascending: true });
    if (error) throw error;
    return data;
}

async function addBankProfile(supabase, userId, nome, identificador, palavras_ignorar, cartao_final) {
    if (!supabase) throw new Error("Supabase não configurado.");
    const { error } = await supabase
        .from('bank_profiles')
        .insert({ nome, identificador, palavras_ignorar, cartao_final, user_id: userId });
    if (error) throw error;
}

async function updateBankProfile(supabase, userId, id, nome, identificador, palavras_ignorar, cartao_final) {
    if (!supabase) throw new Error("Supabase não configurado.");
    const { error } = await supabase
        .from('bank_profiles')
        .update({ nome, identificador, palavras_ignorar, cartao_final })
        .eq('id', id)
        .eq('user_id', userId);
    if (error) throw error;
}

async function deleteBankProfile(supabase, userId, id) {
    if (!supabase) throw new Error("Supabase não configurado.");
    const { error } = await supabase
        .from('bank_profiles')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);
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

// ─────────────────────────────────────────────
// Monthly Summary for Agent
// ─────────────────────────────────────────────
async function getMonthlySummary(supabase, userId, year, month) {
    const rows = await getRows(supabase, userId);
    const pad = (n) => String(n).padStart(2, '0');
    const prefix = `${pad(month)}/${year}`;

    let totalEntradas = 0, totalSaidas = 0, totalInvestido = 0;
    const categoryCount = {}, dayTotals = {}, cardTotals = {}, investByDesc = {};

    rows.forEach(row => {
        const dataStr = row['Data'];
        if (!dataStr) return;
        const [day, m, y] = dataStr.split('/');
        if (`${m}/${y}` !== prefix) return;

        const valorStr = String(row['Valor (R$)'] || '0').replace(/\./g, '').replace(',', '.');
        const valor = parseFloat(valorStr);
        if (isNaN(valor)) return;

        const tipo = row['Tipo'];
        const categoria = row['Categoria'] || 'Outros';
        const banco = row['Banco/Cartão'] || 'Outros';
        const descricao = row['Descrição'] || '';

        if (tipo === 'Entrada') {
            totalEntradas += valor;
        } else if (categoria === 'Investimento' || categoria === 'Investimentos') {
            totalInvestido += valor;
            investByDesc[descricao] = (investByDesc[descricao] || 0) + valor;
        } else {
            totalSaidas += valor;
            categoryCount[categoria] = (categoryCount[categoria] || 0) + 1;
        }

        // Totais por cartão/banco (apenas saídas)
        if (tipo !== 'Entrada') {
            if (!cardTotals[banco]) cardTotals[banco] = { total: 0, count: 0 };
            cardTotals[banco].total += valor;
            cardTotals[banco].count += 1;
        }

        const dayKey = `${day}/${m}`;
        if (!dayTotals[dayKey]) dayTotals[dayKey] = { entradas: 0, saidas: 0 };
        if (tipo === 'Entrada') dayTotals[dayKey].entradas += valor;
        else dayTotals[dayKey].saidas += valor;
    });

    const topCategories = Object.entries(categoryCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    const busyDay = Object.entries(dayTotals)
        .map(([day, v]) => ({ day, total: v.entradas + v.saidas, entradas: v.entradas, saidas: v.saidas }))
        .sort((a, b) => b.total - a.total)[0] || null;

    const topCards = Object.entries(cardTotals)
        .map(([banco, v]) => ({ banco, total: v.total, count: v.count }))
        .sort((a, b) => b.total - a.total);

    const topInvestments = Object.entries(investByDesc)
        .map(([desc, valor]) => ({ desc, valor }))
        .sort((a, b) => b.valor - a.valor)
        .slice(0, 5);

    return { totalEntradas, totalSaidas, totalInvestido, topCategories, busyDay, topCards, topInvestments };
}

module.exports = {
    supabaseGlobal,
    initDatabase,
    getRows,
    getMonthlySummary,
    saveTransactionsToDb,
    autoRegisterSuppliers,
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
