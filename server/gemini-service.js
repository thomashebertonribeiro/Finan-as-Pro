const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const { getSetting, getBankProfiles, supabaseGlobal } = require("./database");

// Helper para buscar setting com fallback para env var
async function getSettingWithFallback(key, envFallback) {
    try {
        if (supabaseGlobal) {
            // Busca sem user_id (configuração global)
            const { data } = await supabaseGlobal.from('settings').select('value').eq('key', key).limit(1).single();
            if (data?.value) return data.value;
        }
    } catch (e) { /* ignora */ }
    return envFallback || null;
}

/**
 * Processa uma imagem usando Google Gemini Vision para extrair transações financeiras.
 * @param {string} imagePath Caminho local da imagem.
 * @param {string} mimeType Tipo MIME da imagem (image/png, image/jpeg).
 * @returns {Promise<Array|null>} Lista de objetos de transação ou null se falhar/não configurado.
 */
async function processImageWithGemini(imagePath, mimeType) {
    try {
        const apiKey = await getSettingWithFallback('gemini_api_key', process.env.GEMINI_API_KEY);
        if (!apiKey || !apiKey.trim()) {
            console.log("⚠️ Gemini API Key não configurada. Usando OCR local (Tesseract).");
            return null;
        }

        console.log("🤖 Processando imagem com Google Gemini IA...");
        const genAI = new GoogleGenerativeAI(apiKey);
        // A conta do usuário possui acesso exclusivo à série Gemini 2.5
        const model = genAI.getGenerativeModel({ 
            model: "gemini-2.5-flash",
            generationConfig: { responseMimeType: "application/json" }
        });

        const imageData = fs.readFileSync(imagePath);
        const imagePart = {
            inlineData: {
                data: Buffer.from(imageData).toString("base64"),
                mimeType
            },
        };

        const today = new Date();
        const currentYear = today.getFullYear();
        
        // Busca perfis de banco para passar ao Gemini como contexto de identificação
        const bankProfiles = await getBankProfiles();
        const profilesContext = bankProfiles.map(p => 
            `- Banco: ${p.nome} (ID: ${p.identificador})${p.cartao_final ? `, Cartão Final: ${p.cartao_final}` : ''}. IGNORE estas palavras/labels se aparecerem como descrição: [${p.palavras_ignorar}]`
        ).join('\n');

        const systemPrompt = await getSetting('gemini_system_prompt') || '';
        
        const prompt = `
            ${systemPrompt}

            REGRAS DE EXTRAÇÃO TÉCNICA:
            Você é um assistente financeiro especializado. Extraia transações de compras/gastos deste comprovante.
            
            CONFIGURAÇÃO DE BANCOS:
            ${profilesContext}

            REGRAS CRÍTICAS:
            1. IDENTIFICAÇÃO: Use o nome do banco ou final do cartão para definir o campo "banco".
            2. NÃO EXTRAIA METADADOS: Ignore linhas como "Cartão final", "VISA", "MASTERCARD", "PAGAMENTOS", etc.
            3. FOCO: Extraia apenas nomes de estabelecimentos reais.
            4. FORMATO: Retorne EXATAMENTE no formato JSON abaixo.
            5. SE NÃO ENCONTRAR NADA: Retorne o JSON com lista vazia: {"banco": "Desconhecido", "transacoes": []}
            6. DATA: Use o ano ${currentYear} se não houver ano no comprovante.

            JSON FORMAT:
            {
              "banco": "NOME_DO_BANCO_OU_ID",
              "transacoes": [
                {"Data": "DD/MM/AAAA", "Descricao": "NOME DO LOCAL", "Valor": "0,00"}
              ]
            }
        `;

        const result = await model.generateContent([prompt, imagePart]);
        const response = await result.response;
        const text = response.text().trim();
        
        console.log("DEBUG: Resposta bruta do Gemini:", text);

        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch (e) {
            // Tentativa de extração se houver markdown
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    parsed = JSON.parse(jsonMatch[0]);
                } catch (e2) {
                    throw new Error(`Falha no parse do JSON extraído: ${e2.message}`);
                }
            } else {
                throw new Error(`Resposta da IA não é um JSON válido e não contém blocos JSON.`);
            }
        }

        const rawTransactions = Array.isArray(parsed) ? parsed : (parsed.transacoes || []);
        const bancoDetetado = Array.isArray(parsed) ? 'Desconhecido' : (parsed.banco || 'Desconhecido');

        // Log de debug para arquivo
        const logEntry = `\n--- ${new Date().toISOString()} ---\nBANCO: ${bancoDetetado}\nRAW:\n${text}\n`;
        fs.appendFileSync("gemini_debug.log", logEntry);
        console.log(`🤖 Log gerado para o banco: ${bancoDetetado}`);

        // Carrega palavras a ignorar e termos de metadados
        let globalJunk = ["compras a vista", "compras no credito", "ourocard", "visa", "mastercard", "comprovante", "final do cartao", "final cartao", "final :", "cartao final"];
        let dynamicJunk = bankProfiles
            .flatMap(p => p.palavras_ignorar.split(',').map(w => w.trim()).filter(w => w.length > 0));
        
        const currentProfile = bankProfiles.find(p => p.identificador === bancoDetetado);
        if (currentProfile && currentProfile.cartao_final) {
            dynamicJunk.push(`final ${currentProfile.cartao_final}`);
            dynamicJunk.push(`${currentProfile.cartao_final}`);
        }

        const normalize = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        const junkNormalized = [...new Set([...globalJunk, ...dynamicJunk].map(normalize))];
        
        const processed = rawTransactions.map(t => ({
            ...t,
            normDesc: normalize(t.Descricao || t.Descrição || '')
        }));

        const finalTransactions = [];
        const seenValues = new Map();

        processed.forEach(t => {
            const val = t.Valor.toString().replace(/\D/g, '');
            if (!seenValues.has(val)) seenValues.set(val, []);
            seenValues.get(val).push(t);
        });

        processed.forEach(t => {
            const desc = t.normDesc;
            const valNorm = t.Valor.toString().replace(/\D/g, '');
            
            // Filtros de exclusão
            if (junkNormalized.some(k => k && desc.includes(k))) return;
            if (/^[\/\d\s:á.]+$/.test(desc) || desc.length < 3 || desc.includes('/202') || desc.includes(' às ')) return;
            if (desc.includes('final ') || desc.includes('cartao') || desc === 'visa' || desc === 'mastercard') return;

            // Lógica de descarte de duplicatas por label
            const siblings = seenValues.get(valNorm);
            if (siblings && siblings.length > 1) {
                const isLikelyLabel = desc.includes('compras') || desc.includes('final') || desc.includes('cartao') || desc.includes('pagamento');
                const hasBetterSibling = siblings.some(s => s !== t && normalize(s.Descricao || s.Descrição || '').length > 2 && !normalize(s.Descricao || s.Descrição || '').includes('final'));
                if (isLikelyLabel && hasBetterSibling) return;
            }

            finalTransactions.push(t);
        });

        console.log(`✅ Gemini: ${bancoDetetado} | ${finalTransactions.length} transações legítimas.`);

        if (!finalTransactions.length) {
            const emptyLog = `\n--- INFO ${new Date().toISOString()} ---\nBanco: ${bancoDetetado} | Nenhuma transação extraída após filtros.\n`;
            fs.appendFileSync("gemini_debug.log", emptyLog);
            return null;
        }

        const getMonthName = (dateStr) => {
            if (!dateStr) return today.toLocaleString('pt-BR', { month: 'long' });
            const parts = dateStr.split('/');
            if (parts.length === 3) {
                const monthInd = parseInt(parts[1], 10) - 1;
                return new Date(2026, monthInd, 1).toLocaleString('pt-BR', { month: 'long' });
            }
            return today.toLocaleString('pt-BR', { month: 'long' });
        };

        return finalTransactions.map(t => ({
            'Data': t.Data || today.toLocaleDateString('pt-BR'),
            'Mês': getMonthName(t.Data),
            'Descrição': (t.Descricao || t.Descrição || 'Sem descrição').toUpperCase(),
            'Tipo': 'Saída',
            'Tipo de Pagamento': 'Crédito',
            'Parcela': '1/1',
            'Banco/Cartão': bancoDetetado,
            'Categoria': 'Outros',
            'Valor (R$)': (t.Valor ? t.Valor.toString().replace('.', ',') : '0,00')
        }));

    } catch (error) {
        const errorMsg = `\n--- ERROR ${new Date().toISOString()} ---\n${error.message}\n${error.stack}\n`;
        fs.appendFileSync("gemini_debug.log", errorMsg);
        console.error("❌ Erro no Gemini Service:", error.message);
        return null;
    }
}

/**
 * Processa uma mensagem de texto para interpretar intenções de agenda (compromissos).
 * @param {string} text Mensagem do usuário.
 * @param {string} contextDate Data atual em ISO 8601 para resolver datas relativas.
 * @returns {Promise<object|null>} Objeto com intent e campos extraídos, ou null se falhar.
 */
async function processAppointmentMessage(text, contextDate) {
    try {
        const apiKey = await getSetting('gemini_api_key');
        if (!apiKey || !apiKey.trim()) return null;

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: { responseMimeType: "application/json" }
        });

        const prompt = `
Você é um assistente de agenda pessoal. Analise a mensagem do usuário e retorne um JSON classificando a intenção e extraindo os dados relevantes.

Data e hora atual (ISO 8601): ${contextDate}

INTENÇÕES POSSÍVEIS:
- "criar": usuário quer agendar/marcar/criar um compromisso
- "consultar": usuário quer ver/listar compromissos de um período
- "editar": usuário quer alterar/modificar um compromisso existente
- "cancelar": usuário quer cancelar/remover um compromisso existente
- "outro": mensagem não relacionada a agenda

FORMATO DE RESPOSTA JSON:

Para intent "criar":
{
  "intent": "criar",
  "titulo": "string (título do compromisso)",
  "data_hora": "string (ISO 8601 com timezone, ex: 2025-07-15T14:00:00-03:00)",
  "descricao": "string ou null",
  "lembrete_minutos": number (padrão 15 se não mencionado),
  "recorrencia": "unica" | "semanal" | "mensal"
}

Para intent "consultar":
{
  "intent": "consultar",
  "periodo": {
    "start": "string (ISO 8601)",
    "end": "string (ISO 8601)"
  }
}

Para intent "editar":
{
  "intent": "editar",
  "alvo": {
    "titulo": "string ou null",
    "data_hora": "string (ISO 8601) ou null"
  },
  "campos_editar": {
    "titulo": "string ou null",
    "data_hora": "string (ISO 8601) ou null",
    "descricao": "string ou null",
    "lembrete_minutos": number ou null,
    "recorrencia": "unica" | "semanal" | "mensal" ou null
  }
}

Para intent "cancelar":
{
  "intent": "cancelar",
  "alvo": {
    "titulo": "string ou null",
    "data_hora": "string (ISO 8601) ou null"
  }
}

Para intent "outro":
{
  "intent": "outro"
}

REGRAS:
- Resolva datas relativas ("amanhã", "próxima sexta", "semana que vem") com base na data atual fornecida.
- Use o timezone -03:00 (Brasília) se não houver indicação de timezone.
- Se o usuário não mencionar hora, use 09:00 como padrão.
- Para "consultar" sem período específico, use o dia atual como start e end.
- Para "consultar" um mês inteiro, use o primeiro e último dia do mês.
- Recorrência padrão é "unica" se não mencionada.
- Lembrete padrão é 15 minutos se não mencionado.

MENSAGEM DO USUÁRIO: "${text}"
`;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text().trim();

        let parsed;
        try {
            parsed = JSON.parse(responseText);
        } catch {
            const match = responseText.match(/\{[\s\S]*\}/);
            if (match) parsed = JSON.parse(match[0]);
            else return null;
        }

        return parsed;
    } catch (err) {
        console.error('❌ [Gemini Appointment] Erro:', err.message);
        return null;
    }
}

/**
 * Processa uma mensagem de texto usando Gemini para interpretar intenção financeira.
 * Retorna um objeto estruturado com a ação detectada.
 */
async function processTextWithGemini(text) {
    try {
        const apiKey = await getSetting('gemini_api_key');
        if (!apiKey || !apiKey.trim()) return null;

        const systemPrompt = await getSetting('gemini_system_prompt') || '';
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: { responseMimeType: "application/json" }
        });

        const today = new Date();
        const fmt = (v) => `R$ ${v.toFixed(2).replace('.', ',')}`;
        const summaryContext = '';

        const prompt = `
${systemPrompt}

Você é um assistente financeiro pessoal via WhatsApp. Analise a mensagem do usuário e retorne um JSON com a ação correta.
Data de hoje: ${today.toLocaleDateString('pt-BR')}
Mês atual: ${today.toLocaleString('pt-BR', { month: 'long' })} (mês ${today.getMonth() + 1}/${today.getFullYear()})
${summaryContext}

AÇÕES POSSÍVEIS:
1. "lancamento" — usuário quer registrar uma transação (gastei, paguei, recebi, investi, comprei, etc.)
2. "resumo" — usuário quer ver relatório/resumo financeiro (pode ser de qualquer mês)
3. "ajuda" — usuário não sabe o que fazer ou pediu ajuda
4. "outro" — mensagem não relacionada a finanças

FORMATO DE RESPOSTA JSON:
{
  "acao": "lancamento" | "resumo" | "ajuda" | "outro",
  "mesPedido": null | { "mes": 1-12, "ano": 2024-2026 },
  "transacao": {
    "descricao": "string",
    "valor": "0,00",
    "tipo": "Saída" | "Entrada",
    "categoria": "Alimentação" | "Transporte" | "Saúde" | "Lazer" | "Educação" | "Moradia" | "Seguros" | "Investimentos" | "Outros",
    "tipoPagamento": "Pix" | "Crédito" | "Débito" | "Dinheiro" | "Boleto"
  },
  "mensagemResposta": "string (resposta amigável para o usuário, em português)"
}

REGRAS:
- Se acao != "lancamento", o campo "transacao" pode ser null.
- Se o usuário mencionar um mês específico (ex: "março", "janeiro", "fevereiro"), preencha "mesPedido" com o mês e ano corretos. Se não mencionar mês, use null (será usado o mês atual).
- Para "resumo", NÃO gere a mensagemResposta com dados financeiros — deixe mensagemResposta como null. Os dados serão buscados pelo sistema com base no mesPedido.
- Para "lancamento", extraia valor, descrição, tipo e categoria da mensagem.
- Para "ajuda" ou "outro", gere uma mensagemResposta amigável com emojis.

MENSAGEM DO USUÁRIO: "${text}"
`;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text().trim();

        let parsed;
        try {
            parsed = JSON.parse(responseText);
        } catch {
            const match = responseText.match(/\{[\s\S]*\}/);
            if (match) parsed = JSON.parse(match[0]);
            else return null;
        }

        return parsed;
    } catch (err) {
        console.error('❌ [Gemini Text] Erro:', err.message);
        return null;
    }
}

module.exports = { processImageWithGemini, processTextWithGemini, processAppointmentMessage };
