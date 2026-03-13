# Finanças Pro - Documentação Completa do Sistema

Este documento fornece uma visão detalhada das funcionalidades e da arquitetura técnica do sistema **Finanças Pro**.

---

## 1. Visão Geral
O **Finanças Pro** é um ecossistema de gestão financeira pessoal projetado para reduzir o esforço manual de registro de gastos. Ele combina uma interface web moderna com tecnologias de automação como OCR (Reconhecimento Óptico de Caracteres) e integração com o WhatsApp.

---

## 2. Funcionalidades Principais

### 📊 Dashboard Interativo
- **Resumo Financeiro**: Visualização instantânea de Entradas, Saídas, Saldo Total e total Investido.
- **Gráficos Dinâmicos**: Gráfico de evolução mensal e distribuição de gastos por categoria.
- **Filtros Inteligentes**: Seleção de período (Data Inicial/Final) com atualização em tempo real de todas as métricas.

### 🤖 Agente IA (Painel de Controle)
- **Terminal de Logs**: Monitoramento em tempo real do processamento da IA, permitindo ver exatamente o que o Gemini está extraindo e eventuais erros de processamento.
- **Customização de Prompt**: Edite o "System Prompt" diretamente pelo dashboard para ajustar o tom e as regras de extração do assistente.
- **Gerenciamento de Chaves**: Configure sua Gemini API Key e o número autorizado do WhatsApp sem mexer em arquivos de código.

### 🤖 Automação via WhatsApp
- **Lançamento Inteligente**: Envie mensagens como "Gastei 50 no mercado" ou fotos de comprovantes.
- **Detecção de Bancos**: O sistema identifica automaticamente de qual banco é o comprovante (Ex: C6, Ourocard) e aplica as regras de limpeza específicas.
- **Processamento Gemini 2.5**: Utiliza a tecnologia mais avançada da Google para extração de dados com precisão superior ao OCR tradicional.
- **Confirmação Interativa**: O bot solicita confirmação via chat antes de salvar qualquer dado no banco.

### 📝 Gestão de Lançamentos (CRUD)
- **Histórico Real-time**: Aba dedicada com polling automático que reflete lançamentos feitos via WhatsApp instantaneamente.
- **Edição e Exclusão**: Controle total sobre os dados passados, permitindo correções rápidas.

### 🏷️ Inteligência de Fornecedores e Bancos
- **Mapeamento de Categorias**: Cadastre seus fornecedores e deixe que o sistema categorize tudo sozinho.
- **Perfis de Bancos**: Configure identificadores e filtros (como número final de cartão) para que a IA nunca se confunda entre contas diferentes.

---

## 3. Informações Técnicas

### Stack Tecnológica
- **Frontend**: 
  - **React.js + Vite**: Performance e desenvolvimento moderno.
  - **Recharts**: Biblioteca de alta qualidade para visualização de dados.
  - **CSS Customizado**: Design premium com efeitos de glassmorphism (transparências e desfoques).
- **Backend**:
  - **Node.js + Express**: Servidor robusto para APIs REST.
  - **Google Gemini 2.5 Flash**: Extração de dados via IA de última geração para alta precisão.
  - **SQLite**: Banco de dados relacional local para transações, configurações e perfis.
  - **Baileys**: Implementação da API do WhatsApp via WebSocket.
  - **Tesseract.js**: Motor de OCR utilizado como fallback (contingência).

### Estrutura de Dados (SQLite)
O sistema utiliza um banco de dados relacional (`database.sqlite`) com as seguintes tabelas:
1. **`transactions`**: Armazena os lançamentos financeiros validados.
2. **`suppliers`**: Mapeamento de fornecedores para categorias.
3. **`settings`**: Armazena chaves de API, números autorizados e prompts de sistema.
4. **`bank_profiles`**: Configurações específicas de cada banco (C6, Ourocard, etc) para limpeza de dados.

### Arquitetura de Pastas
- `/client`: Código fonte do frontend React.
- `/server`: Lógica do servidor, API, banco de dados e serviços de IA/WhatsApp.
- `/server/baileys_auth_info`: Armazena a sessão de autenticação do WhatsApp.

### Segurança e Privacidade
- **Dados Locais**: Toda a informação financeira reside na sua máquina, no arquivo SQLite. Nada é enviado para servidores de terceiros (exceto o processamento local do OCR).
- **Sem Cloud**: O sistema não depende de Google Sheets ou outras APIs de nuvem para funcionar após o setup inicial.

---

## 4. Requisitos de Sistema
- **Node.js**: Versão 18.x ou superior.
- **Navegador**: Chrome, Edge ou Safari atualizados.
- **WhatsApp**: Aplicativo móvel para o pareamento inicial via QR Code.

---

**Desenvolvido por Thomas Ribeiro com assistência da Antigravity IA.**
