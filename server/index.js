require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const Tesseract = require('tesseract.js');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const app = express();
app.use(cors());
app.use(express.json());

// Rota Raiz / Health Check
app.get('/', (req, res) => res.send('🚀 Backend Finanças Pro funcionando!'));

const upload = multer({ dest: 'uploads/' });
const { 
    initDatabase, getRows, saveTransactionsToDb, updateTransactionInDb, deleteTransactionFromDb,
    getSuppliers, addSupplier, updateSupplier, deleteSupplierFromDb,
    getSettings, updateSetting,
    getBankProfiles, addBankProfile, updateBankProfile, deleteBankProfile
} = require('./database');
const { parseFinancialData } = require('./utils');
const { processImageWithGemini } = require('./gemini-service');
const waService = require('./whatsapp-service');
const QRCode = require('qrcode');

// Inicialização movida para o listen para garantir bind rápido da porta
// initDatabase()...
// waService.connectToWhatsApp()... (veja final do arquivo)

// Endpoint WhatsApp QR
app.get('/whatsapp-qr', async (req, res) => {
    const qr = waService.getQrCode();
    if (!qr) return res.status(404).json({ error: 'QR Code não disponível ou já conectado.' });

    try {
        const qrImage = await QRCode.toDataURL(qr);
        res.json({ qr: qrImage });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao gerar imagem do QR Code' });
    }
});

// Endpoint WhatsApp Status
app.get('/whatsapp-status', (req, res) => {
    res.json({ status: waService.getStatus() });
});

app.post('/whatsapp-logout', async (req, res) => {
    try {
        console.log('--- Recebido pedido de logout do WhatsApp ---');
        await waService.logoutWhatsApp();
        // Dispara uma nova tentativa de conexão para gerar um novo QR Code
        waService.connectToWhatsApp().catch(err => console.error("Erro ao reiniciar conexão:", err));
        res.json({ message: 'Desconectado com sucesso! Reiniciando conexão...' });
    } catch (error) {
        console.error('Erro detalhado no logout:', error);
        res.status(500).json({ error: 'Erro ao desconectar', details: error.message });
    }
});

app.post('/process-image', upload.array('images'), async (req, res) => {
    if (!req.files || req.files.length === 0) return res.status(400).send('Nenhuma imagem enviada.');

    try {
        console.log(`--- Processando ${req.files.length} imagens ---`);
        let allTransactions = [];
        let fullRawText = "";

        const suppliers = await getSuppliers();

        for (const file of req.files) {
            const { path: imagePath } = file;
            const mimeType = file.mimetype || 'image/jpeg';

            // --- Tenta processar com Gemini IA ---
            let transactions = await processImageWithGemini(imagePath, mimeType);

            if (transactions) {
                console.log(`✅ Gemini: ${transactions.length} transações encontradas em ${file.originalname}`);
                // Aplica categorização automática
                transactions = transactions.map(t => {
                    const matchedSupplier = suppliers.find(sup =>
                        t.Descrição.toLowerCase().includes(sup.nome.toLowerCase())
                    );
                    if (matchedSupplier) t.Categoria = matchedSupplier.categoria;
                    return t;
                });
            } else {
                // --- Fallback para Tesseract ---
                console.log(`⚠️ Gemini indisponível. Usando Tesseract para ${file.originalname}`);
                const { data: { text } } = await Tesseract.recognize(imagePath, 'por');
                fullRawText += `\n--- FILE: ${file.originalname} ---\n${text}`;
                transactions = parseFinancialData(text, suppliers);
            }

            allTransactions = [...allTransactions, ...transactions];

            try { fs.unlinkSync(imagePath); } catch (e) { console.error("Erro ao deletar temp:", e); }
        }

        if (fullRawText) {
            fs.writeFileSync(path.join(__dirname, 'last_ocr_debug.txt'), fullRawText);
        }

        const uniqueTransactions = allTransactions.filter((v, i, a) =>
            a.findIndex(t => t.Descrição === v.Descrição && t['Valor (R$)'] === v['Valor (R$)'] && t.Data === v.Data) === i
        );

        console.log(`Total de transações: ${uniqueTransactions.length}`);
        res.json({ message: 'Processamento concluído.', data: uniqueTransactions });
    } catch (err) {
        console.error('ERRO /process-image:', err);
        res.status(500).json({ error: 'Erro no processamento das imagens', details: err.message });
    }
});

// Endpoint 2: Salva transações confirmadas pelo usuário
app.post('/save-transactions', async (req, res) => {
    const { transactions } = req.body;

    if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
        return res.status(400).json({ error: 'Nenhuma transação para salvar.' });
    }

    try {
        console.log(`--- Salvando ${transactions.length} transações confirmadas ---`);
        await saveTransactionsToDb(transactions);

        console.log('✅ Dados salvos no banco local!');
        res.json({ message: 'Sucesso! Dados gravados no banco de dados.' });
    } catch (err) {
        console.error('ERRO AO SALVAR:', err);
        res.status(500).json({ error: 'Erro ao gravar no banco', details: err.message });
    }
});

// Endpoint 3: Busca resumo para o Dashboard com Filtros
app.get('/dashboard-stats', async (req, res) => {
    const { startDate, endDate } = req.query; // Formato esperado: YYYY-MM-DD
    console.log(`[DEBUG /dashboard-stats] req.query:`, req.query);

    try {
        const rows = await getRows();

        let totalEntradas = 0;
        let totalSaidas = 0;
        let totalInvestido = 0;
        let globalTotal = 0; // Independente de filtro
        const monthlyData = {};
        const categoryData = {};

        const start = startDate ? new Date(startDate + 'T00:00:00') : null;
        const end = endDate ? new Date(endDate + 'T23:59:59') : null;

        rows.forEach(row => {
            const dataStr = row['Data']; // DD/MM/AAAA
            if (!dataStr) return;

            const [day, month, year] = dataStr.split('/');
            const rowDate = new Date(year, month - 1, day);

            const valorRaw = row['Valor (R$)'];
            if (!valorRaw) return;

            const valorStr = String(valorRaw).replace(/\./g, '').replace(',', '.');
            const valor = parseFloat(valorStr);
            if (isNaN(valor)) return;

            const tipo = row['Tipo'];
            const categoria = row['Categoria'] || 'Geral';

            if (tipo === 'Entrada') {
                globalTotal += valor;
            } else {
                globalTotal -= valor;
            }

            // Filtro de Período
            if (start && rowDate < start) return;
            if (end && rowDate > end) return;

            if (tipo === 'Entrada') {
                totalEntradas += valor;
            } else if (categoria === 'Investimentos') {
                totalInvestido += valor;
                // Investimentos não reduzem o "total entradas" mas são uma saída de caixa
            } else {
                totalSaidas += valor;
                // Agrupamento por Categoria (apenas saídas comuns)
                categoryData[categoria] = (categoryData[categoria] || 0) + valor;
            }

            // Agrupamento por mês/ano para o gráfico
            const monthYear = `${month}/${year}`;
            if (!monthlyData[monthYear]) monthlyData[monthYear] = { name: monthYear, entradas: 0, saidas: 0, investimentos: 0 };
            if (tipo === 'Entrada') monthlyData[monthYear].entradas += valor;
            else if (categoria === 'Investimentos') monthlyData[monthYear].investimentos += valor;
            else monthlyData[monthYear].saidas += valor;
        });

        // Formata lista de categorias ordenada por valor
        const categoryList = Object.entries(categoryData)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value);

        res.json({
            total: globalTotal.toFixed(2).replace('.', ','), // Agora é o global
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
        console.error('ERRO STATS:', err);
        res.status(500).json({ error: 'Erro ao carregar estatísticas' });
    }
});

// Endpoint CRUD: Listar todas as transações
app.get('/transactions', async (req, res) => {
    try {
        const rows = await getRows();
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao carregar transações', details: error.message });
    }
});

// Endpoint CRUD: Atualizar transação
app.put('/transactions/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const transactionData = req.body;
        await updateTransactionInDb(id, transactionData);
        res.json({ message: 'Transação atualizada!' });
    } catch (error) {
        console.error('Erro PUT:', error);
        res.status(500).json({ error: 'Erro ao atualizar transação', details: error.message });
    }
});

// Endpoint CRUD: Deletar transação
app.delete('/transactions/:id', async (req, res) => {
    try {
        const id = req.params.id;
        await deleteTransactionFromDb(id);
        res.json({ message: 'Transação excluída!' });
    } catch (error) {
        console.error('Erro DELETE:', error);
        res.status(500).json({ error: 'Erro ao excluir transação', details: error.message });
    }
});

// --- ENPOINTS FORNECEDORES (SUPPLIERS) --- //

// GET: Listar Fornecedores
app.get('/suppliers', async (req, res) => {
    try {
        const suppliers = await getSuppliers();
        res.json(suppliers);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar fornecedores', details: error.message });
    }
});

// POST: Criar Fornecedor
app.post('/suppliers', async (req, res) => {
    try {
        const { nome, categoria } = req.body;
        if (!nome || !categoria) return res.status(400).json({ error: 'Nome e categoria são obrigatórios' });
        await addSupplier(nome, categoria);
        res.status(201).json({ message: 'Fornecedor cadastrado com sucesso!' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao cadastrar fornecedor', details: error.message });
    }
});

// PUT: Atualizar Fornecedor
app.put('/suppliers/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const { nome, categoria } = req.body;
        await updateSupplier(id, nome, categoria);
        res.json({ message: 'Fornecedor atualizado!' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao atualizar fornecedor', details: error.message });
    }
});

// DELETE: Excluir Fornecedor
app.delete('/suppliers/:id', async (req, res) => {
    try {
        const id = req.params.id;
        await deleteSupplierFromDb(id);
        res.json({ message: 'Fornecedor excluído!' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao excluir fornecedor', details: error.message });
    }
});

// --- ENDPOINTS DE CONFIGURAÇÕES (SETTINGS) --- //

// GET: Buscar todas as configurações
app.get('/settings', async (req, res) => {
    try {
        const settings = await getSettings();
        res.json(settings);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar configurações' });
    }
});

// POST: Atualizar uma configuração específica
app.post('/settings', async (req, res) => {
    try {
        const { key, value } = req.body;
        if (!key) return res.status(400).json({ error: 'Chave é obrigatória' });
        await updateSetting(key, value);
        res.json({ message: `Configuração ${key} atualizada!` });
    } catch (error) {
        console.error('ERRO SETTINGS POST:', error.message);
        res.status(500).json({ error: 'Erro ao atualizar configuração', details: error.message });
    }
});

// --- ENDPOINTS DE LOGS DA IA --- //

app.get('/ai-logs', (req, res) => {
    const logPath = path.join(__dirname, 'gemini_debug.log');
    if (!fs.existsSync(logPath)) {
        return res.json({ logs: "Nenhum log disponível ainda." });
    }
    try {
        const content = fs.readFileSync(logPath, 'utf8');
        // Retorna as últimas 100 linhas para não sobrecarregar
        const lines = content.split('\n').slice(-100).join('\n');
        res.json({ logs: lines });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao ler logs' });
    }
});

app.delete('/ai-logs', (req, res) => {
    const logPath = path.join(__dirname, 'gemini_debug.log');
    try {
        if (fs.existsSync(logPath)) {
            fs.writeFileSync(logPath, '');
        }
        res.json({ message: 'Logs limpos com sucesso!' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao limpar logs' });
    }
});

// --- ENDPOINTS DE PERFIS DE BANCO --- //

app.get('/bank-profiles', async (req, res) => {
    try {
        console.log('--- Requisição recebida em GET /bank-profiles ---');
        const profiles = await getBankProfiles();
        res.json(profiles);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar perfis de banco', details: error.message });
    }
});

app.post('/bank-profiles', async (req, res) => {
    try {
        const { nome, identificador, palavras_ignorar, cartao_final } = req.body;
        if (!nome || !identificador) return res.status(400).json({ error: 'Nome e identificador são obrigatórios' });
        await addBankProfile(nome, identificador, palavras_ignorar || '', cartao_final || '');
        res.status(201).json({ message: 'Perfil de banco criado!' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao criar perfil', details: error.message });
    }
});

app.put('/bank-profiles/:id', async (req, res) => {
    try {
        const { nome, identificador, palavras_ignorar, cartao_final } = req.body;
        await updateBankProfile(req.params.id, nome, identificador, palavras_ignorar || '', cartao_final || '');
        res.json({ message: 'Perfil de banco atualizado!' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao atualizar perfil', details: error.message });
    }
});

app.delete('/bank-profiles/:id', async (req, res) => {
    try {
        await deleteBankProfile(req.params.id);
        res.json({ message: 'Perfil excluído!' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao excluir perfil', details: error.message });
    }
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
    console.log(`🚀 Servidor pronto na porta ${PORT}`);
    
    // Inicia serviços pesados após o servidor estar online
    console.log('--- Iniciando serviços em segundo plano... ---');
    initDatabase().catch(err => console.error("Falha ao iniciar banco de dados:", err));
    waService.connectToWhatsApp().catch(err => console.error("Falha ao iniciar WhatsApp:", err));
});
