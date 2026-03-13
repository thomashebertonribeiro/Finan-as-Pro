function parseFinancialData(text, suppliers = []) {
    const normalizedText = text.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, '-');
    const lines = normalizedText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const transactions = [];

    // Regex principal: Captura valores com , . ou / (erro comum de OCR) seguidos de 2 dígitos
    const genericValueRegex = /(?:\s|^)(?:R\$\s?)?(\d{1,3}(?:\.\d{3})*[.,\/]\d{2})(?!\d)/;
    const fallbackValueRegex = /(?:\s|^)(\d{3,4})$/;
    const dateRegex = /(\d{2}\/\d{2}\/\d{2,4})/;
    
    const BLACKLIST = [
        'ourocard', 'visa', 'fatura', 'mar abr', 'thomas', 'heberton', 'ribeiro',
        'compras à vista', 'total', 'saldo', 'pagar fatura', 'vencimento', 'limite',
        'extrato', 'brasileiro', 'banco do brasil', 'parcela', 'no crédito', 'pagamento'
    ];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lowerLine = line.toLowerCase();
        
        // Filtro de linha morta (data isolada ou cabeçalho)
        if (dateRegex.test(line) && line.length < 15) continue;
        if (line.startsWith('/') || line.startsWith('às')) continue;

        let valueMatch = line.match(genericValueRegex);
        let usedFallback = false;

        if (!valueMatch && line.length > 3) {
            const fallbackMatch = line.match(fallbackValueRegex);
            if (fallbackMatch) {
                const val = fallbackMatch[1];
                // Evita anos e números de cartão 
                if (!['2025', '2026', '6303', '8639', '0000'].includes(val) && !lowerLine.includes('visa')) {
                    valueMatch = fallbackMatch;
                    usedFallback = true;
                }
            }
        }

        if (valueMatch) {
            let rawValue = valueMatch[1];
            if (usedFallback) rawValue = rawValue.slice(0, -2) + ',' + rawValue.slice(-2);
            const valorParaSalvar = rawValue.replace(/\./g, '').replace(/[\/]/g, ',').replace(',', '.').replace('.', ','); 

            // Busca descrição
            let descricao = line.replace(valueMatch[0], '').replace(/[|*_-]/g, ' ').replace(/\d{2}\/\d{2}\/\d{2,4}.*/, '').trim();

            // Se a descrição é fraca, busca acima
            if (descricao.length < 3 || BLACKLIST.some(k => descricao.toLowerCase().includes(k))) {
                for (let k = 1; k <= 3; k++) {
                    const prevIdx = i - k;
                    if (prevIdx < 0) break;
                    const prevLine = lines[prevIdx];
                    const prevLower = prevLine.toLowerCase();
                    if (!genericValueRegex.test(prevLine) && !dateRegex.test(prevLine) && 
                        !BLACKLIST.some(k => prevLower.includes(k)) && prevLine.length > 2) {
                        descricao = prevLine.replace(/[|*_-]/g, ' ').trim();
                        break;
                    }
                }
            }

            const lowerDesc = descricao.toLowerCase();
            
            // --- VALIDAÇÃO FINAL DA DESCRIÇÃO ---
            let isInvalid = false;
            if (lowerDesc.length < 3) isInvalid = true;
            if (BLACKLIST.some(k => lowerDesc.includes(k)) && !lowerDesc.includes('uber')) isInvalid = true;
            if (lowerDesc.match(/^\d+$/)) isInvalid = true; // Só números
            if (lowerDesc.startsWith('/')) isInvalid = true;

            if (isInvalid) continue;

            // Busca data
            let dataTransacao = new Date().toLocaleDateString('pt-BR');
            const foundDate = line.match(dateRegex);
            if (foundDate) {
                dataTransacao = foundDate[0];
            } else {
                for (let k = 1; k <= 4; k++) {
                    if (i + k < lines.length && dateRegex.test(lines[i + k])) {
                        dataTransacao = lines[i + k].match(dateRegex)[0];
                        break;
                    }
                }
            }

            // Categorização Automática
            let categoriaAutomática = 'Outros';
            if (suppliers && suppliers.length > 0) {
                const matchedSupplier = suppliers.find(sup => 
                    lowerDesc.includes(sup.nome.toLowerCase())
                );
                if (matchedSupplier) {
                    categoriaAutomática = matchedSupplier.categoria;
                }
            }

            transactions.push({
                'Data': dataTransacao,
                'Mês': new Date().toLocaleString('pt-BR', { month: 'long' }),
                'Descrição': descricao.substring(0, 100),
                'Tipo': 'Saída',
                'Tipo de Pagamento': 'Crédito',
                'Parcela': '1/1',
                'Banco/Cartão': 'Ourocard Visa',
                'Categoria': categoriaAutomática,
                'Valor (R$)': valorParaSalvar
            });
        }
    }

    return transactions.filter((v, i, a) =>
        a.findIndex(t => t.Descrição === v.Descrição && t['Valor (R$)'] === v['Valor (R$)']) === i
    );
}

module.exports = { parseFinancialData };
