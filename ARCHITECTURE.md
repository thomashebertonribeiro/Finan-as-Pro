# Arquitetura Técnica - Finanças Pro

## Visão Geral
O sistema "Finanças Pro" é uma aplicação de gerenciamento financeiro local que combina um dashboard web interativo com automações de extração de dados (OCR) e um bot de WhatsApp. A persistência de dados é feita através de um banco de dados **SQLite** local.

## Stack Tecnológico

### Frontend (`/client`)
- **Tecnologia Base**: React.js com Vite.
- **Estilização**: CSS Customizado (Glassmorphism design).
- **Gráficos**: `Recharts`.
- **Navegação**: Sistema de abas (Tabs) para alternar entre Dashboard, Lançamentos e Fornecedores.

### Backend (`/server`)
- **Tecnologia Base**: Node.js com Express.
- **Integração IA**: **Google Gemini 2.5 Flash** (Principal) e `tesseract.js` (Fallback).
- **Integração WhatsApp**: `@whiskeysockets/baileys` (Protocolo WebSocket).
- **Banco de Dados**: `sqlite3` e `sqlite`.

## Estrutura de Arquivos e Módulos
- `index.js`: Ponto de entrada e definição de rotas REST.
- `database.js`: Operações SQLite (Tabelas: transações, fornecedores, configurações e perfis bancários).
- `gemini-service.js`: Orquestrador da comunicação com a API do Gemini, incluindo lógica de limpeza de RAW JSON.
- `whatsapp-service.js`: Gerencia conexão, autenticação e handlers de mensagens do WhatsApp.
- `utils.js`: Helpers para parsing e validação de dados financeiros.
- `start_system.bat`: Inicializador global (Front + Back).

## Fluxos de Dados

### 1. Processamento IA (Gemini 2.5)
1. **Entrada**: Imagem via Upload ou WhatsApp.
2. **Extração**: O sistema envia a imagem + System Prompt dinâmico para o Gemini 2.5 Flash.
3. **Identificação de Banco**: O sistema analisa o conteúdo para identificar o banco (Ex: C6, Ourocard) e aplica filtros específicos definidos em `bank_profiles`.
4. **Categorização**: Cruzamento com a tabela de Fornecedores para atribuição automática de categorias.
5. **Logs**: Todo o processo é registrado em tempo real no terminal da aba "Agente IA".

### 2. Automação WhatsApp
1. O usuário envia uma mensagem ou imagem.
2. O servidor valida se o número é autorizado (tabela `settings`).
3. Após o processamento, o bot envia um resumo interativo.
4. Ao receber o comando "Sim", os dados são persistidos via `saveTransactionsToDb`.

