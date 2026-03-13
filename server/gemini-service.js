const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const { getSetting, getBankProfiles } = require("./database");

/**
 * Processa uma imagem usando Google Gemini Vision para extrair transações financeiras.
 * @param {string} imagePath Caminho local da imagem.
 * @param {string} mimeType Tipo MIME da imagem (image/png, image/jpeg).
 * @returns {Promise<Array|null>} Lista de objetos de transação ou null se falhar/não configurado.
 */
async function processImageWithGemini(imagePath, mimeType) {
    try {
        const apiKey = await getSetting('gemini_api_key');
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

module.exports = { processImageWithGemini };
