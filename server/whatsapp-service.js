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
const os = require('os');
// const Tesseract = require('tesseract.js'); // Movido para dentro das funções
const { parseFinancialData } = require('./utils');
const { saveTransactionsToDb, getSuppliers, getSetting, getMonthlySummary, supabaseAdmin } = require('./database');
const { processImageWithGemini, processTextWithGemini, processAppointmentMessage } = require('./gemini-service');
const appointmentService = require('./appointment-service');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

let sock;
let qrCode = null;
let connectionStatus = 'disconnected'; // 'disconnected', 'connecting', 'connected', 'qr_ready'

const pendingConfirmations = {};

async function connectToWhatsApp() {
    try {
        console.log('--- [WHATSAPP] Iniciando Conexão ---');
        qrCode = null;
        connectionStatus = 'connecting';
        
        // Usa diretório temporário para garantir permissão de escrita em Cloud/Docker
        const authPath = path.join(os.tmpdir(), 'financas_pro_baileys_auth');
        if (!fs.existsSync(authPath)) {
            console.log(`--- [WHATSAPP] Criando diretório de autenticação em ${authPath}... ---`);
            fs.mkdirSync(authPath, { recursive: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(authPath);
        // Busca versão do WA com timeout e fallback para versão fixa
        let version, isLatest;
        try {
            const versionResult = await Promise.race([
                fetchLatestBaileysVersion(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout 10s')), 10000))
            ]);
            version = versionResult.version;
            isLatest = versionResult.isLatest;
        } catch (e) {
            console.warn(`⚠️ [WHATSAPP] Não foi possível buscar versão online (${e.message}). Usando versão fixa.`);
            version = [2, 3000, 1035194821];
            isLatest = false;
        }

        console.log(`--- [WHATSAPP] Versão: ${version}, isLatest: ${isLatest} ---`);

        sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'error' }), // Reduzindo log para não poluir
        });

        sock.ev.on('connection.update', (update) => {
            try {
                const { connection, lastDisconnect, qr } = update;

                if (qr) {
                    console.log(`✨ [WHATSAPP] QR STRING RECEBIDA (${qr.substring(0, 10)}...)`);
                    qrCode = qr;
                    connectionStatus = 'qr_ready';
                }

                if (connection === 'close') {
                    const error = lastDisconnect?.error;
                    const statusCode = (error instanceof Boom) ? error.output.statusCode : (error?.output?.statusCode || 0);
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                    
                    console.error(`❌ [WHATSAPP] Conexão Fechada (Status: ${statusCode}):`, error?.message || 'Sem mensagem erro');
                    
                    connectionStatus = shouldReconnect ? 'connecting' : 'disconnected';
                    qrCode = null;

                    if (shouldReconnect) {
                        console.log('--- [WHATSAPP] Reiniciando em 5s... ---');
                        setTimeout(() => connectToWhatsApp().catch(e => {}), 5000);
                    }
                } else if (connection === 'open') {
                    console.log('🚀 [WHATSAPP] Conectado com sucesso!');
                    connectionStatus = 'connected';
                    qrCode = null;
                }
            } catch (err) {
                console.error('❌ [WHATSAPP] Erro no listener de conexão:', err.message);
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
                // Resolve userId pelo número de telefone (usado em todas as queries ao banco)
                const waUserId = await appointmentService.resolveUserIdByPhone(supabaseAdmin, remoteJid);

                // 0. Processar mensagens enviadas para OUTROS somente se habilitado
                if (fromMe) {
                    if (!botId) {
                        console.log("⚠️ sock.user não disponível ainda.");
                        continue;
                    }
                    console.log(`DEBUG: fromMe=${fromMe}, isSelfChat=${isSelfChat}, botNum=${botNum}, recipient=${remoteNum}, jid=${remoteJid}, botLid=${botLid}`);
                    
                    const processOutgoing = waUserId ? await getSetting(supabaseAdmin, waUserId, 'process_outgoing_messages') : null;
                    if (!isSelfChat && processOutgoing !== 'true') {
                         console.log(`⚠️ Mensagem para terceiros (${remoteJid}) ignorada por precaução (configuração desativada).`);
                         continue;
                    }
                }

                // 1. Ignorar Grupos e Status
                if (remoteJid.endsWith('@g.us') || remoteJid.includes('@broadcast') || remoteJid === 'status@broadcast') continue;

                // 2. Verificar Número Autorizado
                const authorizedSetting = waUserId ? await getSetting(supabaseAdmin, waUserId, 'whatsapp_authorized_number') : null;
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

                    // Confirmações de agenda (cancelar/editar)
                    const pending = pendingConfirmations[remoteJid];
                    if (pending && pending.type === 'cancelar_appointment') {
                        if (['sim', 's', 'ok', 'confirmar'].includes(response)) {
                            try {
                                await appointmentService.cancelAppointment(pending.supabase, pending.userId, pending.appointmentId, false);
                                await sock.sendMessage(remoteJid, { text: '✅ Compromisso cancelado com sucesso.' });
                            } catch (e) {
                                await sock.sendMessage(remoteJid, { text: '❌ Erro ao cancelar compromisso.' });
                            }
                            delete pendingConfirmations[remoteJid];
                            continue;
                        } else if (pending.isRecorrente && ['série', 'serie', 'todos', 'todas'].includes(response)) {
                            try {
                                await appointmentService.cancelAppointment(pending.supabase, pending.userId, pending.appointmentId, true);
                                await sock.sendMessage(remoteJid, { text: '✅ Série de compromissos cancelada com sucesso.' });
                            } catch (e) {
                                await sock.sendMessage(remoteJid, { text: '❌ Erro ao cancelar série.' });
                            }
                            delete pendingConfirmations[remoteJid];
                            continue;
                        } else if (['não', 'nao', 'n', 'cancelar', 'parar'].includes(response)) {
                            await sock.sendMessage(remoteJid, { text: '👍 Operação cancelada. Compromisso mantido.' });
                            delete pendingConfirmations[remoteJid];
                            continue;
                        }
                    }

                    if (pending && pending.type === 'editar_appointment') {
                        if (['sim', 's', 'ok', 'confirmar'].includes(response)) {
                            try {
                                const campos = Object.fromEntries(
                                    Object.entries(pending.campos).filter(([, v]) => v !== null && v !== undefined)
                                );
                                await appointmentService.updateAppointment(pending.supabase, pending.userId, pending.appointmentId, campos);
                                await sock.sendMessage(remoteJid, { text: '✅ Compromisso atualizado com sucesso.' });
                            } catch (e) {
                                await sock.sendMessage(remoteJid, { text: '❌ Erro ao atualizar compromisso.' });
                            }
                            delete pendingConfirmations[remoteJid];
                            continue;
                        } else if (['não', 'nao', 'n', 'cancelar'].includes(response)) {
                            await sock.sendMessage(remoteJid, { text: '👍 Edição cancelada. Compromisso não alterado.' });
                            delete pendingConfirmations[remoteJid];
                            continue;
                        }
                    }

                    // Confirmações financeiras existentes
                    if (!pending.type) {
                        if (['sim', 's', 'ok', 'confirmar', 'pode', 'bora'].includes(response)) {
                            const data = pendingConfirmations[remoteJid];
                            if (waUserId) {
                                await saveTransactionsToDb(supabaseAdmin, waUserId, data);
                            }
                            await sock.sendMessage(remoteJid, { text: `✅ *${data.length} transações salvas no banco de dados!*` });
                            delete pendingConfirmations[remoteJid];
                            continue;
                        } else if (['não', 'nao', 'n', 'cancelar', 'parar'].includes(response)) {
                            await sock.sendMessage(remoteJid, { text: '❌ *Operação cancelada.* Nada foi salvo.' });
                            delete pendingConfirmations[remoteJid];
                            continue;
                        }
                    }
                }

                try {
                    if (messageType === 'conversation' || messageType === 'extendedTextMessage') {
                        await handleTextMessage(sock, remoteJid, textMsg, waUserId);
                    } else if (messageType === 'imageMessage') {
                        await handleImageMessage(sock, remoteJid, msgContent.imageMessage, waUserId);
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

/**
 * Formata uma data ISO 8601 para exibição amigável em pt-BR.
 */
function formatDataHora(isoString) {
    try {
        const d = new Date(isoString);
        const data = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        return `${data} às ${hora}`;
    } catch {
        return isoString;
    }
}

/**
 * Roteador de intenções de agenda. Executa a ação correspondente e responde ao usuário.
 *
 * @param {object} sock - Socket Baileys
 * @param {string} jid - JID do destinatário
 * @param {string} userId - UUID do usuário no Supabase
 * @param {object} supabase - Cliente Supabase
 * @param {string} intent - 'criar' | 'consultar' | 'editar' | 'cancelar'
 * @param {object} dados - Dados extraídos pelo NLP
 */
async function handleAppointmentIntent(sock, jid, userId, supabase, intent, dados) {
    try {
        if (intent === 'criar') {
            const created = await appointmentService.createAppointment(supabase, userId, {
                titulo: dados.titulo,
                data_hora: dados.data_hora,
                descricao: dados.descricao || null,
                lembrete_minutos: dados.lembrete_minutos || 15,
                recorrencia: dados.recorrencia || 'unica',
            });

            const appt = created[0];
            const recorrenciaLabel = appt.recorrencia !== 'unica'
                ? ` (recorrência ${appt.recorrencia})`
                : '';
            const lembreteLabel = appt.lembrete_minutos
                ? `\n⏰ *Lembrete:* ${appt.lembrete_minutos} minutos antes`
                : '';
            const descLabel = appt.descricao ? `\n📝 *Descrição:* ${appt.descricao}` : '';
            const totalLabel = created.length > 1 ? `\n📅 *Total de ocorrências:* ${created.length}` : '';

            const msg =
                `✅ *Compromisso agendado!*\n\n` +
                `📌 *Título:* ${appt.titulo}${recorrenciaLabel}\n` +
                `🗓️ *Data/Hora:* ${formatDataHora(appt.data_hora)}` +
                descLabel +
                lembreteLabel +
                totalLabel;

            await sock.sendMessage(jid, { text: msg });
            return;
        }

        if (intent === 'consultar') {
            const periodo = dados.periodo || {};
            const appointments = await appointmentService.getAppointments(supabase, userId, {
                start: periodo.start,
                end: periodo.end,
            });

            if (!appointments || appointments.length === 0) {
                await sock.sendMessage(jid, { text: '📅 Nenhum compromisso encontrado para o período solicitado.' });
                return;
            }

            // Paginar em blocos de 10
            const PAGE_SIZE = 10;
            for (let i = 0; i < appointments.length; i += PAGE_SIZE) {
                const page = appointments.slice(i, i + PAGE_SIZE);
                let msg = i === 0
                    ? `📅 *Seus compromissos (${appointments.length} total):*\n`
                    : `📅 *Continuação (${i + 1}–${Math.min(i + PAGE_SIZE, appointments.length)}):*\n`;

                page.forEach((a, idx) => {
                    const recLabel = a.recorrencia !== 'unica' ? ` 🔁${a.recorrencia}` : '';
                    msg += `\n${i + idx + 1}. *${a.titulo}*${recLabel}\n   🗓️ ${formatDataHora(a.data_hora)}`;
                    if (a.descricao) msg += `\n   📝 ${a.descricao}`;
                });

                await sock.sendMessage(jid, { text: msg });
            }
            return;
        }

        if (intent === 'cancelar') {
            const alvo = dados.alvo || {};
            // Busca compromissos que correspondam ao alvo
            const all = await appointmentService.getAppointments(supabase, userId);
            const candidates = all.filter(a => {
                const tituloMatch = alvo.titulo
                    ? a.titulo.toLowerCase().includes(alvo.titulo.toLowerCase())
                    : true;
                const dataMatch = alvo.data_hora
                    ? a.data_hora.startsWith(alvo.data_hora.substring(0, 10))
                    : true;
                return tituloMatch && dataMatch;
            });

            if (candidates.length === 0) {
                await sock.sendMessage(jid, { text: '⚠️ Nenhum compromisso encontrado para cancelar com os dados informados.' });
                return;
            }

            const target = candidates[0];
            const isRecorrente = target.recorrencia !== 'unica' && target.recorrencia_grupo_id;

            let confirmMsg =
                `❓ *Deseja cancelar este compromisso?*\n\n` +
                `📌 *Título:* ${target.titulo}\n` +
                `🗓️ *Data/Hora:* ${formatDataHora(target.data_hora)}`;

            if (isRecorrente) {
                confirmMsg += `\n\n🔁 Este compromisso é recorrente (${target.recorrencia}).\nResponda:\n• *"Sim"* — cancelar apenas este\n• *"Série"* — cancelar este e todos os futuros\n• *"Não"* — manter`;
            } else {
                confirmMsg += `\n\nResponda *"Sim"* para confirmar ou *"Não"* para manter.`;
            }

            // Armazena confirmação pendente de agenda
            pendingConfirmations[jid] = {
                type: 'cancelar_appointment',
                appointmentId: target.id,
                isRecorrente,
                userId,
                supabase,
            };

            await sock.sendMessage(jid, { text: confirmMsg });
            return;
        }

        if (intent === 'editar') {
            const alvo = dados.alvo || {};
            const camposEditar = dados.campos_editar || {};

            const all = await appointmentService.getAppointments(supabase, userId);
            const candidates = all.filter(a => {
                const tituloMatch = alvo.titulo
                    ? a.titulo.toLowerCase().includes(alvo.titulo.toLowerCase())
                    : true;
                const dataMatch = alvo.data_hora
                    ? a.data_hora.startsWith(alvo.data_hora.substring(0, 10))
                    : true;
                return tituloMatch && dataMatch;
            });

            if (candidates.length === 0) {
                await sock.sendMessage(jid, { text: '⚠️ Nenhum compromisso encontrado para editar com os dados informados.' });
                return;
            }

            const target = candidates[0];
            const alteracoes = Object.entries(camposEditar)
                .filter(([, v]) => v !== null && v !== undefined)
                .map(([k, v]) => {
                    if (k === 'data_hora') return `  • Data/Hora: ${formatDataHora(v)}`;
                    if (k === 'titulo') return `  • Título: ${v}`;
                    if (k === 'descricao') return `  • Descrição: ${v}`;
                    if (k === 'lembrete_minutos') return `  • Lembrete: ${v} minutos antes`;
                    if (k === 'recorrencia') return `  • Recorrência: ${v}`;
                    return `  • ${k}: ${v}`;
                })
                .join('\n');

            const confirmMsg =
                `✏️ *Editar compromisso?*\n\n` +
                `📌 *Atual:* ${target.titulo} — ${formatDataHora(target.data_hora)}\n\n` +
                `*Alterações propostas:*\n${alteracoes || '  (nenhuma alteração detectada)'}\n\n` +
                `Responda *"Sim"* para confirmar ou *"Não"* para cancelar.`;

            pendingConfirmations[jid] = {
                type: 'editar_appointment',
                appointmentId: target.id,
                campos: camposEditar,
                userId,
                supabase,
            };

            await sock.sendMessage(jid, { text: confirmMsg });
            return;
        }
    } catch (err) {
        console.error('❌ [Agenda] Erro em handleAppointmentIntent:', err.message);
        await sock.sendMessage(jid, { text: '❌ Erro ao processar sua solicitação de agenda. Tente novamente.' });
    }
}

async function handleTextMessage(sock, jid, text, userId) {
    const now = new Date();

    // --- ROTEAMENTO DE AGENDA (antes do fluxo financeiro) ---
    const appointmentResult = await processAppointmentMessage(text, now.toISOString());
    if (appointmentResult && appointmentResult.intent && appointmentResult.intent !== 'outro') {
        if (!supabaseAdmin) {
            console.warn('⚠️ [Agenda] supabaseAdmin não disponível. Continuando para fluxo financeiro.');
        } else {
            const userId = await appointmentService.resolveUserIdByPhone(supabaseAdmin, jid);
            if (!userId) {
                console.warn(`⚠️ [Agenda] Número ${jid} não mapeado a nenhum user_id. Continuando para fluxo financeiro.`);
            } else {
                await handleAppointmentIntent(sock, jid, userId, supabaseAdmin, appointmentResult.intent, appointmentResult);
                return;
            }
        }
    }
    // --- FIM DO ROTEAMENTO DE AGENDA ---

    // Tenta processar via Gemini primeiro (detecta intenção e mês pedido)
    const geminiResult = await processTextWithGemini(text);

    if (geminiResult) {
        const { acao, mesPedido, transacao, mensagemResposta } = geminiResult;

        if (acao === 'lancamento' && transacao) {
            const suppliers = userId ? await getSuppliers(supabaseAdmin, userId) : [];
            let categoria = transacao.categoria || 'Outros';
            const matchedSupplier = suppliers.find(s =>
                transacao.descricao?.toLowerCase().includes(s.nome.toLowerCase())
            );
            if (matchedSupplier) categoria = matchedSupplier.categoria;

            const transaction = {
                'Data': now.toLocaleDateString('pt-BR'),
                'Mês': now.toLocaleString('pt-BR', { month: 'long' }),
                'Descrição': (transacao.descricao || 'Lançamento via WhatsApp').substring(0, 100),
                'Tipo': transacao.tipo || 'Saída',
                'Tipo de Pagamento': transacao.tipoPagamento || 'Pix',
                'Parcela': '1/1',
                'Banco/Cartão': 'WhatsApp',
                'Categoria': categoria,
                'Valor (R$)': transacao.valor || '0,00'
            };

            pendingConfirmations[jid] = [transaction];
            const confirmMsg = mensagemResposta ||
                `❓ *Deseja salvar este lançamento?*\n\n📝 *Item:* ${transaction['Descrição']}\n💰 *Valor:* R$ ${transaction['Valor (R$)']}\n📁 *Categoria:* ${transaction['Categoria']}\n\nResponda *"Sim"* para confirmar ou *"Não"* para cancelar.`;
            await sock.sendMessage(jid, { text: confirmMsg });
            return;
        }

        if (acao === 'resumo') {
            // Determina o mês/ano a buscar
            const targetYear  = mesPedido?.ano  || now.getFullYear();
            const targetMonth = mesPedido?.mes   || (now.getMonth() + 1);
            const summary = userId
                ? await getMonthlySummary(supabaseAdmin, userId, targetYear, targetMonth)
                : { totalEntradas: 0, totalSaidas: 0, totalInvestido: 0, topCategories: [], topCards: [], topInvestments: [], busyDay: null };

            const fmt = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const mesNome = new Date(targetYear, targetMonth - 1, 1).toLocaleString('pt-BR', { month: 'long' });

            let msg = `📊 *Resumo de ${mesNome}/${targetYear}*\n\n`;
            msg += `💰 *Entradas:* R$ ${fmt(summary.totalEntradas)}\n`;
            msg += `💸 *Gastos:* R$ ${fmt(summary.totalSaidas)}\n`;
            if (summary.totalInvestido > 0) msg += `📈 *Investido:* R$ ${fmt(summary.totalInvestido)}\n`;
            msg += `🏦 *Saldo do mês:* R$ ${fmt(summary.totalEntradas - summary.totalSaidas - summary.totalInvestido)}\n`;

            if (summary.topCards?.length > 0) {
                msg += `\n💳 *Cartão/banco mais usado:* ${summary.topCards[0].banco} — R$ ${fmt(summary.topCards[0].total)}\n`;
            }

            if (summary.topCategories.length > 0) {
                msg += `\n🏷️ *Categorias com mais lançamentos:*\n`;
                summary.topCategories.forEach(([cat, count], i) => {
                    msg += `  ${i + 1}. ${cat} (${count} lançamento${count > 1 ? 's' : ''})\n`;
                });
            }

            if (summary.topInvestments?.length > 0) {
                msg += `\n📈 *Investimentos:*\n`;
                summary.topInvestments.forEach(inv => {
                    msg += `  • ${inv.desc}: R$ ${fmt(inv.valor)}\n`;
                });
            }

            if (summary.busyDay) {
                msg += `\n📅 *Dia mais movimentado:* ${summary.busyDay.day}\n`;
                msg += `  ↑ R$ ${fmt(summary.busyDay.entradas)} | ↓ R$ ${fmt(summary.busyDay.saidas)}`;
            }

            await sock.sendMessage(jid, { text: msg });
            return;
        }

        if (acao === 'ajuda' || acao === 'outro') {
            const msg = mensagemResposta ||
                '🤖 Olá! Eu sou seu assistente financeiro.\n\nVocê pode me enviar:\n1. *Texto:* "Gastei 50 no mercado"\n2. *Imagem:* Print do comprovante\n3. *Resumo:* "Resumo de março" ou "Como foi janeiro?"\n\nEu registro tudo automaticamente! 🚀';
            await sock.sendMessage(jid, { text: msg });
            return;
        }
    }

    // Fallback: regex simples se Gemini não estiver configurado
    const regex = /(gastei|recebi|investi|paguei|comprei)\s+(\d+(?:[.,]\d{2})?)\s+(?:no|na|em|com|de|pelo|pela)?\s*(.*)/i;
    const match = text.match(regex);

    if (match) {
        const acao = match[1].toLowerCase();
        const valor = match[2].replace(',', '.');
        let tipo = 'Saída';
        let categoria = 'Outros';
        if (acao === 'recebi') tipo = 'Entrada';
        if (acao === 'investi') categoria = 'Investimentos';

        const descricaoFinal = match[3]?.trim() || 'Lançamento via WhatsApp';
        const suppliers = userId ? await getSuppliers(supabaseAdmin, userId) : [];
        const matchedSupplier = suppliers.find(s => descricaoFinal.toLowerCase().includes(s.nome.toLowerCase()));
        if (matchedSupplier && categoria === 'Outros') categoria = matchedSupplier.categoria;

        const transaction = {
            'Data': now.toLocaleDateString('pt-BR'),
            'Mês': now.toLocaleString('pt-BR', { month: 'long' }),
            'Descrição': descricaoFinal.substring(0, 100),
            'Tipo': tipo,
            'Tipo de Pagamento': 'Pix',
            'Parcela': '1/1',
            'Banco/Cartão': 'WhatsApp',
            'Categoria': categoria,
            'Valor (R$)': valor.replace('.', ',')
        };

        pendingConfirmations[jid] = [transaction];
        await sock.sendMessage(jid, { text: `❓ *Deseja salvar este lançamento?*\n\n📝 *Item:* ${transaction['Descrição']}\n💰 *Valor:* R$ ${transaction['Valor (R$)']}\n📁 *Categoria:* ${transaction['Categoria']}\n\nResponda *"Sim"* para confirmar ou *"Não"* para cancelar.` });
    } else {
        await sock.sendMessage(jid, { text: '🤖 Olá! Eu sou seu assistente financeiro.\n\nVocê pode me enviar:\n1. *Texto:* "Gastei 50 no mercado"\n2. *Imagem:* Print do comprovante\n3. *Resumo:* "Resumo do mês"\n\nEu registro tudo automaticamente! 🚀' });
    }
}

async function handleImageMessage(sock, jid, imageMessage, userId) {
    await sock.sendMessage(jid, { text: '🤖 *Lendo comprovante com IA...* Aguarde um momento.' });

    const stream = await downloadContentFromMessage(imageMessage, 'image');
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }

    const tempPath = path.join(__dirname, `temp_wa_${Date.now()}.jpg`);
    fs.writeFileSync(tempPath, buffer);

    try {
        const suppliers = userId ? await getSuppliers(supabaseAdmin, userId) : [];
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

    const authPath = path.join(os.tmpdir(), 'financas_pro_baileys_auth');
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
