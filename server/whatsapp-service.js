const {
    makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    downloadContentFromMessage
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
// const Tesseract = require('tesseract.js'); // Movido para dentro das funções
const { parseFinancialData } = require('./utils');
const { saveTransactionsToDb, getSuppliers, getSetting } = require('./database');
const { processImageWithGemini } = require('./gemini-service');

let sock;
let qrCode = null;
let connectionStatus = 'disconnected'; // 'disconnected', 'connecting', 'connected', 'qr_ready'

const pendingConfirmations = {};

async function connectToWhatsApp() {
    try {
        console.log('--- [WHATSAPP] Iniciando Conexão ---');
        qrCode = null;
        connectionStatus = 'connecting';
        
        // Verifica se o diretório é gravável (Railway tip)
        const authPath = path.resolve('baileys_auth_info');
        if (!fs.existsSync(authPath)) {
            console.log('--- [WHATSAPP] Criando diretório de autenticação... ---');
            fs.mkdirSync(authPath, { recursive: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(authPath);
        const { version, isLatest } = await fetchLatestBaileysVersion();

        console.log(`--- [WHATSAPP] Versão: ${version} ---`);

        sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'error' }), // Reduzindo log para não poluir
        });

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log(`✨ [WHATSAPP] Novo QR Code recebido! (Tamanho: ${qr.length})`);
                qrCode = qr;
                connectionStatus = 'qr_ready';
            }

            if (connection === 'close') {
                const statusCode = (lastDisconnect.error instanceof Boom) ? lastDisconnect.error.output.statusCode : 0;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                console.error(`❌ [WHATSAPP] Conexão Fechada (${statusCode}):`, lastDisconnect.error?.message);
                
                connectionStatus = shouldReconnect ? 'connecting' : 'disconnected';
                qrCode = null;

                if (shouldReconnect) {
                    console.log('--- [WHATSAPP] Reiniciando em 5s... ---');
                    setTimeout(() => connectToWhatsApp(), 5000);
                }
            } else if (connection === 'open') {
                console.log('🚀 [WHATSAPP] Conectado!');
                connectionStatus = 'connected';
                qrCode = null;
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
        // Ignorar 'append' (sincronização de histórico) para evitar loops infinitos
        // Em versões recentes do Baileys, self-chat ao vivo também chega como 'notify'
        if (type !== 'notify') return;

        console.log(`--- Evento upsert: type=${type}, count=${messages.length} ---`);

        for (const m of messages) {
                if (!m.message) continue;
                
                const remoteJid = m.key.remoteJid;
                const fromMe = m.key.fromMe;
                
                console.log(`--- Mensagem Recebida: Remetente=${remoteJid}, fromMe=${fromMe}, type=${type} ---`);

                let isSelfChat = false;
                const botId = sock.user?.id || "";
                const botNum = botId ? botId.split(':')[0].replace(/\D/g, '') : "";
                const botLidFull = sock.user?.lid || "";
                const botLid = botLidFull ? botLidFull.split(':')[0].replace(/\D/g, '') : "";
                const remoteNum = remoteJid.split('@')[0].replace(/\D/g, '');

                if (botNum && remoteNum) {
                    isSelfChat = (botNum.slice(-8) === remoteNum.slice(-8)) || (botLid && remoteNum === botLid);
                }

                // --- FILTRO DE SEGURANÇA ---
                // 0. Processar mensagens enviadas para OUTROS somente se habilitado
                if (fromMe) {
                    if (!botId) {
                        console.log("⚠️ sock.user não disponível ainda.");
                        continue;
                    }
                    console.log(`DEBUG: fromMe=${fromMe}, isSelfChat=${isSelfChat}, botNum=${botNum}, recipient=${remoteNum}, jid=${remoteJid}, botLid=${botLid}`);
                    
                    const processOutgoing = await getSetting('process_outgoing_messages');
                    if (!isSelfChat && processOutgoing !== 'true') {
                         console.log(`⚠️ Mensagem para terceiros (${remoteJid}) ignorada por precaução (configuração desativada).`);
                         continue;
                    }
                }

                // 1. Ignorar Grupos e Status
                if (remoteJid.endsWith('@g.us') || remoteJid.includes('@broadcast') || remoteJid === 'status@broadcast') continue;

                // 2. Verificar Número Autorizado
                const authorizedSetting = await getSetting('whatsapp_authorized_number');
                const senderNumber = remoteNum;

                console.log(`--- Checagem de Segurança: Remetente=${senderNumber}, Autorizado=${authorizedSetting} ---`);

                let isAuthorized = false;
                
                // Mensagens para si mesmo estão implicitamente autorizadas sempre!
                // (Isso abrange o uso do chat 'Você' por ID de telefone numérico e também LID).
                if (isSelfChat) {
                    isAuthorized = true;
                } else if (!authorizedSetting) {
                    // Se não houver config, permite apenas se for o próprio bot informando
                    isAuthorized = (senderNumber === botNum);
                } else if (!senderNumber) {
                    // Se não conseguir extrair o número do remetente, não autoriza
                    isAuthorized = false;
                } else {
                    const cleanAuth = authorizedSetting.replace(/\D/g, '');
                    // Lógica para números brasileiros: Compara os últimos 8 dígitos (evita problemas com 9º dígito e código de país)
                    if (cleanAuth.length >= 8 && senderNumber.length >= 8) {
                        const suffixAuth = cleanAuth.slice(-8);
                        const suffixSender = senderNumber.slice(-8);
                        isAuthorized = (suffixAuth === suffixSender);
                    } else {
                        isAuthorized = (senderNumber.includes(cleanAuth) || cleanAuth.includes(senderNumber));
                    }
                }

                if (!isAuthorized) {
                    console.log(`⚠️ Ignorando mensagem de número não autorizado: ${remoteJid}`);
                    continue;
                }
                // ---------------------------

                // ---------------------------

                // O WhatsApp costuma envelopar mensagens. Desempacotando:
                let msgContent = m.message;
                if (msgContent?.ephemeralMessage) msgContent = msgContent.ephemeralMessage.message;
                if (msgContent?.viewOnceMessage) msgContent = msgContent.viewOnceMessage.message;
                if (msgContent?.documentWithCaptionMessage) msgContent = msgContent.documentWithCaptionMessage.message;
                if (msgContent?.viewOnceMessageV2) msgContent = msgContent.viewOnceMessageV2.message;

                const messageType = Object.keys(msgContent || {})[0];
                console.log(`✅ Processando mensagem autorizada de ${remoteJid} | Tipo: ${messageType}`);
                console.log(`DEBUG: Chaves da mensagem bruta: ${JSON.stringify(Object.keys(m.message))}`);

                const textMsg = msgContent?.conversation || msgContent?.extendedTextMessage?.text || "";

                // Verifica se há confirmação pendente
                if (pendingConfirmations[remoteJid] && textMsg.length > 0) {
                    const response = textMsg.toLowerCase().trim();
                    if (['sim', 's', 'ok', 'confirmar', 'pode', 'bora'].includes(response)) {
                        const data = pendingConfirmations[remoteJid];
                        await saveTransactionsToDb(data);
                        await sock.sendMessage(remoteJid, { text: `✅ *${data.length} transações salvas no banco de dados!*` });
                        delete pendingConfirmations[remoteJid];
                        continue;
                    } else if (['não', 'nao', 'n', 'cancelar', 'parar'].includes(response)) {
                        await sock.sendMessage(remoteJid, { text: '❌ *Operação cancelada.* Nada foi salvo.' });
                        delete pendingConfirmations[remoteJid];
                        continue;
                    }
                }

                try {
                    if (messageType === 'conversation' || messageType === 'extendedTextMessage') {
                        await handleTextMessage(sock, remoteJid, textMsg);
                    } else if (messageType === 'imageMessage') {
                        await handleImageMessage(sock, remoteJid, msgContent.imageMessage);
                    }
                } catch (err) {
                    console.error('Erro ao processar mensagem WA:', err);
                    await sock.sendMessage(remoteJid, { text: '❌ Erro ao processar seu pedido. Tente novamente mais tarde.' });
                }
        }
    });

    } catch (err) {
        console.error('💥 [WHATSAPP] Erro fatal na inicialização:', err.message);
        connectionStatus = 'disconnected';
    }
}

async function handleTextMessage(sock, jid, text) {
    const regex = /(gastei|recebi|investi)\s+(\d+(?:[.,]\d{2})?)\s+(?:no|na|em|com|de)?\s*(.*)/i;
    const match = text.match(regex);

    if (match) {
        const acao = match[1].toLowerCase();
        const valor = match[2].replace(',', '.');
        let tipo = 'Saída';
        let categoria = 'Outros';

        if (acao.includes('recebi')) tipo = 'Entrada';
        if (acao.includes('investi')) {
            tipo = 'Saída';
            categoria = 'Investimentos';
        }

        const descricaoFinal = match[3] ? match[3].trim() : 'Lançamento via WhatsApp';

        // Categorização Automática por Fornecedores
        const suppliers = await getSuppliers();
        const matchedSupplier = suppliers.find(sup => 
            descricaoFinal.toLowerCase().includes(sup.nome.toLowerCase())
        );
        if (matchedSupplier && categoria === 'Outros') {
            categoria = matchedSupplier.categoria;
        }

        const transaction = {
            'Data': new Date().toLocaleDateString('pt-BR'),
            'Mês': new Date().toLocaleString('pt-BR', { month: 'long' }),
            'Descrição': descricaoFinal.substring(0, 100),
            'Tipo': tipo,
            'Tipo de Pagamento': 'Pix',
            'Parcela': '1/1',
            'Banco/Cartão': 'WhatsApp',
            'Categoria': categoria,
            'Valor (R$)': valor.replace('.', ',')
        };

        pendingConfirmations[jid] = [transaction];
        await sock.sendMessage(jid, { text: `❓ *Deseja salvar este lançamento?*\n\n📝 *Item:* ${transaction.Descrição}\n💰 *Valor:* R$ ${transaction['Valor (R$)']}\n📁 *Categoria:* ${transaction.Categoria}\n\nResponda *"Sim"* para confirmar ou *"Não"* para cancelar.` });
    } else {
        await sock.sendMessage(jid, { text: '🤖 Olá! Eu sou seu assistente financeiro.\n\nVocê pode me enviar:\n1. *Texto:* "Gastei 50 no mercado"\n2. *Imagem:* Print do comprovante\n\nEu registro tudo na sua planilha automaticamente! 🚀' });
    }
}

async function handleImageMessage(sock, jid, imageMessage) {
    await sock.sendMessage(jid, { text: '🤖 *Lendo comprovante com IA...* Aguarde um momento.' });

    const stream = await downloadContentFromMessage(imageMessage, 'image');
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }

    const tempPath = path.join(__dirname, `temp_wa_${Date.now()}.jpg`);
    fs.writeFileSync(tempPath, buffer);

    try {
        const suppliers = await getSuppliers();
        let transactions = null;

        // --- Passo 1: Tenta Gemini IA ---
        transactions = await processImageWithGemini(tempPath, 'image/jpeg');

        // --- Passo 2: Fallback para Tesseract se Gemini falhar ---
        if (!transactions) {
            console.log('--- Fallback: Usando OCR Tesseract ---');
            const Tesseract = require('tesseract.js'); // Lazy load
            const { data: { text } } = await Tesseract.recognize(tempPath, 'por');
            fs.writeFileSync(path.join(__dirname, 'last_wa_ocr_debug.txt'), text);
            transactions = parseFinancialData(text, suppliers);
        } else {
            // Aplica categorização automática de fornecedores nos resultados do Gemini
            transactions = transactions.map(t => {
                const matchedSupplier = suppliers.find(sup =>
                    t.Descrição.toLowerCase().includes(sup.nome.toLowerCase())
                );
                if (matchedSupplier) t.Categoria = matchedSupplier.categoria;
                return t;
            });
        }

        if (transactions && transactions.length > 0) {
            pendingConfirmations[jid] = transactions;
            let response = `📋 *${transactions.length} transações identificadas:*\n`;
            transactions.forEach(t => {
                response += `\n📍 ${t.Descrição} - R$ ${t['Valor (R$)']}`;
            });
            response += `\n\n❓ *Deseja salvar estes lançamentos?*\nResponda *"Sim"* ou *"Não"*.`;
            await sock.sendMessage(jid, { text: response });
        } else {
            await sock.sendMessage(jid, { text: '⚠️ *Não consegui extrair dados desta imagem.*\n\nIsso pode acontecer se:\n1. A imagem estiver embaçada\n2. Não for um comprovante financeiro\n3. O banco ainda não for suportado pela minha IA\n\n*Dica:* tente enviar o texto manual (ex: "gastei 50 no mercado").' });
        }
    } catch (err) {
        console.error('Erro ao processar imagem:', err);
        await sock.sendMessage(jid, { text: '❌ Erro ao processar a imagem. Tente novamente mais tarde.' });
    } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
}


function getQrCode() {
    return qrCode;
}

function getStatus() {
    return connectionStatus;
}

async function logoutWhatsApp() {
    console.log('--- Iniciando processo de desconexão/logout ---');
    qrCode = null;
    connectionStatus = 'disconnected';

    if (sock) {
        try {
            // Tentativa de logout limpo com timeout
            await Promise.race([
                sock.logout(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout no logout')), 5000))
            ]).catch(e => console.log('Aviso: Logout limpo falhou ou deu timeout, forçando encerramento.'));
            
            sock.end();
        } catch (err) {
            console.error('Erro ao encerrar socket:', err);
        }
        sock = null;
    }

    const authPath = path.join(process.cwd(), 'baileys_auth_info');
    if (fs.existsSync(authPath)) {
        try {
            fs.rmSync(authPath, { recursive: true, force: true });
            console.log('--- Sessão do WhatsApp removida com sucesso ---');
        } catch (err) {
            console.warn('⚠️ Aviso: Não foi possível deletar a pasta de sessão (pode estar em uso pelo Windows).', err.message);
            // Não relançamos o erro para não quebrar a resposta da API
        }
    }
}

module.exports = { connectToWhatsApp, getQrCode, getStatus, logoutWhatsApp };
