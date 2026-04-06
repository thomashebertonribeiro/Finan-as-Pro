// ============================================================
// SERVIDOR BACKEND - FINANÇAS PRO
// ============================================================

// 1. Handlers Globais de Erro
process.on('uncaughtException', (err) => {
    console.error('💥 [CRASH] UNCAUGHT EXCEPTION:', err.message);
    console.error(err.stack);
});
process.on('unhandledRejection', (reason) => {
    console.error('💥 [CRASH] UNHANDLED REJECTION:', reason);
});
process.on('SIGTERM', () => {
    console.log('🛑 [SISTEMA] SIGTERM recebido.');
    process.exit(0);
});

// 2. Dependências Externas
require('dotenv').config();
const express = require('express');
const authMiddleware = require('./authMiddleware');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3002;

// 3. Middlewares
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json());
app.set('trust proxy', 1);

// 4. Health Checks (para Railway manter o container vivo)
app.get('/', (req, res) => res.json({ status: 'live', version: '4.0' }));
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: Math.round(process.uptime()) }));

// 5. Servidor inicia PRIMEIRO
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 [SERVIDOR] Porta ${PORT} aberta com sucesso. V4.0`);
});

// 6. Módulos carregados APÓS o servidor estar online
let db = null;
let gemini = null;
let utils = null;
let waService = null;
let multer = null;

try {
    multer = require('multer');
    db = require('./database');
    utils = require('./utils');
    gemini = require('./gemini-service');
    waService = require('./whatsapp-service');
    console.log('✅ [BOOT] Todos os módulos carregados.');
    db.initDatabase().catch(e => console.error('❌ [DB] Erro na inicialização:', e.message));
    // Auto-conecta WhatsApp ao iniciar (mantém sessão entre reinicializações)
    waService.connectToWhatsApp().catch(e => console.error('❌ [WHATSAPP] Erro ao auto-conectar:', e.message));
} catch (err) {
    console.error('❌ [CRITICAL] Falha ao carregar módulos:', err.message);
    console.error(err.stack);
}

// Upload de arquivos
const upload = multer ? multer({ dest: 'uploads/' }) : { array: () => (req, res, next) => next() };

// Proxy seguro do WhatsApp
const safeWa = {
    getStatus: () => { try { return waService?.getStatus?.() || 'disconnected'; } catch(e) { return 'disconnected'; } },
    getQrCode: () => { try { return waService?.getQrCode?.() || null; } catch(e) { return null; } },
    connectToWhatsApp: () => { try { return waService?.connectToWhatsApp?.() || Promise.resolve(); } catch(e) { return Promise.resolve(); } },
    logoutWhatsApp: () => { try { return waService?.logoutWhatsApp?.() || Promise.resolve(); } catch(e) { return Promise.resolve(); } }
};

// ============================================================
// ROTAS WHATSAPP
// ============================================================

app.get('/whatsapp-start', (req, res) => {
    console.log('📱 [WHATSAPP] Ativação solicitada.');
    if (!waService) return res.status(503).json({ error: 'Serviço de WhatsApp não disponível.' });
    safeWa.connectToWhatsApp()
        .then(() => console.log('✅ [WHATSAPP] Iniciado.'))
        .catch(err => console.error('❌ [WHATSAPP] Erro ao iniciar:', err.message));
    res.json({ message: 'Iniciando conexão...' });
});

app.get('/whatsapp-status', (req, res) => {
    const status = safeWa.getStatus();
    res.json({ status });
});

app.get('/whatsapp-qr', async (req, res) => {
    const qr = safeWa.getQrCode();
    if (!qr) return res.status(404).json({ error: 'QR Code não disponível.' });
    try {
        const qrImage = await QRCode.toDataURL(qr);
        res.json({ qr: qrImage });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao gerar imagem do QR.' });
    }
});

app.post('/whatsapp-logout', async (req, res) => {
    try {
        await safeWa.logoutWhatsApp();
        safeWa.connectToWhatsApp().catch(() => {});
        res.json({ message: 'Desconectado!' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao desconectar.' });
    }
});

// ============================================================
// ROTAS DE IMAGEM / PROCESSAMENTO
// ============================================================

app.post('/process-image', authMiddleware, upload.array('images'), async (req, res) => {
    if (!db || !gemini) return res.status(503).json({ error: 'Serviço não disponível.' });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Nenhuma imagem enviada.' });

    try {
        const suppliers = await db.getSuppliers(req.supabase, req.userId);
        let allTransactions = [];
        let fullRawText = '';

        for (const file of req.files) {
            const { path: imagePath } = file;
            const mimeType = file.mimetype || 'image/jpeg';
            let transactions = null;

            try {
                transactions = await gemini.processImageWithGemini(imagePath, mimeType);
            } catch (e) {
                console.error('Gemini falhou:', e.message);
            }

            if (transactions) {
                transactions = transactions.map(t => {
                    const match = suppliers.find(s => t.Descrição.toLowerCase().includes(s.nome.toLowerCase()));
                    if (match) t.Categoria = match.categoria;
                    return t;
                });
            } else {
                const Tesseract = require('tesseract.js');
                const { data: { text } } = await Tesseract.recognize(imagePath, 'por');
                fullRawText += `\n--- FILE: ${file.originalname} ---\n${text}`;
                transactions = utils.parseFinancialData(text, suppliers);
            }

            allTransactions = [...allTransactions, ...(transactions || [])];
            try { fs.unlinkSync(imagePath); } catch (e) {}
        }

        if (fullRawText) fs.writeFileSync(path.join(__dirname, 'last_ocr_debug.txt'), fullRawText);

        const unique = allTransactions.filter((v, i, a) =>
            a.findIndex(t => t.Descrição === v.Descrição && t['Valor (R$)'] === v['Valor (R$)'] && t.Data === v.Data) === i
        );

        res.json({ message: 'Processamento concluído.', data: unique });
    } catch (err) {
        console.error('ERRO /process-image:', err);
        res.status(500).json({ error: 'Erro no processamento', details: err.message });
    }
});

// ============================================================
// ROTAS DE TRANSAÇÕES
// ============================================================

app.post('/save-transactions', authMiddleware, async (req, res) => {
    if (!db) return res.status(503).json({ error: 'Banco de dados não disponível.' });
    const { transactions } = req.body;
    if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
        return res.status(400).json({ error: 'Nenhuma transação para salvar.' });
    }
    try {
        const total = transactions.length;
        const newSuppliers = await db.saveTransactionsToDb(req.supabase, req.userId, transactions);
        const saved = total - (newSuppliers._skipped || 0);
        res.json({ message: 'Dados salvos com sucesso!', newSuppliers: newSuppliers || [] });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao salvar', details: err.message });
    }
});

app.get('/dashboard-stats', authMiddleware, async (req, res) => {
    if (!db) return res.json({ total: '0,00', entradas: '0,00', saidas: '0,00', investido: '0,00', categoryList: [], chartData: [] });
    const { startDate, endDate } = req.query;
    try {
        const rows = await db.getRows(req.supabase, req.userId);
        let totalEntradas = 0, totalSaidas = 0, totalInvestido = 0, globalTotal = 0;
        const monthlyData = {}, categoryData = {};
        const start = startDate ? new Date(startDate + 'T00:00:00') : null;
        const end = endDate ? new Date(endDate + 'T23:59:59') : null;

        rows.forEach(row => {
            const dataStr = row['Data'];
            if (!dataStr) return;
            const [day, month, year] = dataStr.split('/');
            const rowDate = new Date(year, month - 1, day);
            const valorStr = String(row['Valor (R$)'] || '0').replace(/\./g, '').replace(',', '.');
            const valor = parseFloat(valorStr);
            if (isNaN(valor)) return;
            const tipo = row['Tipo'];
            const categoria = row['Categoria'] || 'Geral';

            if (tipo === 'Entrada') globalTotal += valor; else globalTotal -= valor;
            if (start && rowDate < start) return;
            if (end && rowDate > end) return;

            if (tipo === 'Entrada') {
                totalEntradas += valor;
            } else if (categoria === 'Investimentos') {
                totalInvestido += valor;
            } else {
                totalSaidas += valor;
                categoryData[categoria] = (categoryData[categoria] || 0) + valor;
            }

            const monthYear = `${month}/${year}`;
            if (!monthlyData[monthYear]) monthlyData[monthYear] = { name: monthYear, entradas: 0, saidas: 0, investimentos: 0 };
            if (tipo === 'Entrada') monthlyData[monthYear].entradas += valor;
            else if (categoria === 'Investimentos') monthlyData[monthYear].investimentos += valor;
            else monthlyData[monthYear].saidas += valor;
        });

        const categoryList = Object.entries(categoryData).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
        res.json({
            total: globalTotal.toFixed(2).replace('.', ','),
            totalPeriodo: (totalEntradas - totalSaidas - totalInvestido).toFixed(2).replace('.', ','),
            entradas: totalEntradas.toFixed(2).replace('.', ','),
            saidas: totalSaidas.toFixed(2).replace('.', ','),
            investido: totalInvestido.toFixed(2).replace('.', ','),
            categoryList,
            chartData: Object.values(monthlyData).sort((a, b) => {
                const [mA, yA] = a.name.split('/');
                const [mB, yB] = b.name.split('/');
                return new Date(yA, mA - 1) - new Date(yB, mB - 1);
            })
        });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao carregar estatísticas' });
    }
});

app.get('/transactions', authMiddleware, async (req, res) => {
    if (!db) return res.json([]);
    try {
        res.json(await db.getRows(req.supabase, req.userId));
    } catch (error) {
        res.status(500).json({ error: 'Erro ao carregar transações' });
    }
});

app.put('/transactions/:id', authMiddleware, async (req, res) => {
    if (!db) return res.status(503).json({ error: 'Banco não disponível.' });
    try {
        await db.updateTransactionInDb(req.supabase, req.userId, req.params.id, req.body);
        res.json({ message: 'Transação atualizada!' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao atualizar', details: error.message });
    }
});

app.delete('/transactions/:id', authMiddleware, async (req, res) => {
    if (!db) return res.status(503).json({ error: 'Banco não disponível.' });
    try {
        await db.deleteTransactionFromDb(req.supabase, req.userId, req.params.id);
        res.json({ message: 'Transação excluída!' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao excluir', details: error.message });
    }
});

// ============================================================
// ROTAS DE FORNECEDORES
// ============================================================

app.get('/suppliers', authMiddleware, async (req, res) => {
    if (!db) return res.json([]);
    try { res.json(await db.getSuppliers(req.supabase, req.userId)); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/suppliers', authMiddleware, async (req, res) => {
    if (!db) return res.status(503).json({ error: 'Banco não disponível.' });
    const { nome, categoria } = req.body;
    if (!nome || !categoria) return res.status(400).json({ error: 'Nome e categoria são obrigatórios' });
    try { await db.addSupplier(req.supabase, req.userId, nome, categoria); res.status(201).json({ message: 'Fornecedor criado!' }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/suppliers/:id', authMiddleware, async (req, res) => {
    if (!db) return res.status(503).json({ error: 'Banco não disponível.' });
    const { nome, categoria } = req.body;
    try { await db.updateSupplier(req.supabase, req.userId, req.params.id, nome, categoria); res.json({ message: 'Fornecedor atualizado!' }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/suppliers/:id', authMiddleware, async (req, res) => {
    if (!db) return res.status(503).json({ error: 'Banco não disponível.' });
    try { await db.deleteSupplierFromDb(req.supabase, req.userId, req.params.id); res.json({ message: 'Fornecedor excluído!' }); } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// ROTAS DE CONFIGURAÇÕES
// ============================================================

app.get('/settings', authMiddleware, async (req, res) => {
    if (!db) return res.json([]);
    try { res.json(await db.getSettings(req.supabase, req.userId)); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/settings', authMiddleware, async (req, res) => {
    if (!db) return res.status(503).json({ error: 'Banco não disponível.' });
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: 'Chave é obrigatória' });
    try { await db.updateSetting(req.supabase, req.userId, key, value); res.json({ message: `Configuração ${key} atualizada!` }); }
    catch (e) { res.status(500).json({ error: 'Erro ao salvar', details: e.message }); }
});

// ============================================================
// ROTAS DE LOGS DA IA
// ============================================================

app.get('/ai-logs', (req, res) => {
    const logPath = path.join(__dirname, 'gemini_debug.log');
    if (!fs.existsSync(logPath)) return res.json({ logs: 'Nenhum log.' });
    try {
        const content = fs.readFileSync(logPath, 'utf8');
        res.json({ logs: content.split('\n').slice(-100).join('\n') });
    } catch (e) { res.status(500).json({ error: 'Erro ao ler logs' }); }
});

app.delete('/ai-logs', (req, res) => {
    const logPath = path.join(__dirname, 'gemini_debug.log');
    try { fs.writeFileSync(logPath, ''); res.json({ message: 'Logs limpos!' }); }
    catch (e) { res.status(500).json({ error: 'Erro ao limpar logs' }); }
});

// ============================================================
// ROTAS DE PERFIS DE BANCO
// ============================================================

app.get('/bank-profiles', authMiddleware, async (req, res) => {
    if (!db) return res.json([]);
    try { res.json(await db.getBankProfiles(req.supabase, req.userId)); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/bank-profiles', authMiddleware, async (req, res) => {
    if (!db) return res.status(503).json({ error: 'Banco não disponível.' });
    const { nome, identificador, palavras_ignorar, cartao_final } = req.body;
    if (!nome || !identificador) return res.status(400).json({ error: 'Nome e identificador são obrigatórios' });
    try { await db.addBankProfile(req.supabase, req.userId, nome, identificador, palavras_ignorar || '', cartao_final || ''); res.status(201).json({ message: 'Perfil criado!' }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/bank-profiles/:id', authMiddleware, async (req, res) => {
    if (!db) return res.status(503).json({ error: 'Banco não disponível.' });
    const { nome, identificador, palavras_ignorar, cartao_final } = req.body;
    try { await db.updateBankProfile(req.supabase, req.userId, req.params.id, nome, identificador, palavras_ignorar || '', cartao_final || ''); res.json({ message: 'Perfil atualizado!' }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/bank-profiles/:id', authMiddleware, async (req, res) => {
    if (!db) return res.status(503).json({ error: 'Banco não disponível.' });
    try { await db.deleteBankProfile(req.supabase, req.userId, req.params.id); res.json({ message: 'Perfil excluído!' }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// MIGRAÇÃO: Auto-cadastrar fornecedores dos lançamentos antigos
// ============================================================

app.post('/migrate-suppliers', authMiddleware, async (req, res) => {
    if (!db) return res.status(503).json({ error: 'Banco não disponível.' });
    try {
        const transactions = await db.getRows(req.supabase, req.userId);
        const newSuppliers = await db.autoRegisterSuppliers(req.supabase, req.userId, transactions);
        res.json({ message: `Migração concluída! ${newSuppliers.length} fornecedor(es) cadastrado(s).`, newSuppliers });
    } catch (err) {
        res.status(500).json({ error: 'Erro na migração', details: err.message });
    }
});
