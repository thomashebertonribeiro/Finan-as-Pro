# Guia de Configuração Local - Finanças Pro

Siga estes passos para rodar o projeto em sua máquina local.

## 1. Pré-requisitos
*   **Node.js**: [Baixe e instale aqui](https://nodejs.org/) (recomendado v18 ou superior).
*   **Git**: Para clonar o repositório.

---

## 2. Instalação das Dependências

Abra o terminal na pasta raiz do projeto e execute os seguintes comandos:

```bash
# Instalar dependências da raiz
npm install

# Instalar dependências do Frontend
cd client
npm install

# Instalar dependências do Backend
cd ../server
npm install
```

---

## 3. Configuração do Ambiente (.env)

Crie um arquivo chamado `.env` dentro da pasta `server/` com o seguinte conteúdo:

```env
PORT=3002
```

---

## 4. Como Rodar o Sistema

Existem duas formas de iniciar:

### A. Usando o Script Automático (Windows)
Apenas dê um duplo clique no arquivo `start_system.bat` na raiz do projeto. Ele abrirá o backend e o frontend simultaneamente.

### B. Manualmente
Se o script não funcionar ou estiver em outro OS, abra dois terminais:

**Terminal 1 (Backend):**
```bash
cd server
node index.js
```

**Terminal 2 (Frontend):**
```bash
cd client
npm run dev
```

---

## 5. Acesso ao Sistema

*   **Dashboard**: Acesse no navegador em `http://localhost:5173`
*   **WhatsApp**: 
    1. Vá em "Configurações" (ícone de engrenagem) no Dashboard.
    2. Escaneie o QR Code com seu celular.
    3. Comece a enviar mensagens como "Gastei 50 no mercado".

---

## 6. Solução de Problemas
*   **Erro de OCR**: Verifique se a pasta `uploads/` existe no servidor.
*   **QR Code não aparece**: Tente reiniciar o processo do servidor e aguarde alguns segundos para a inicialização do Baileys.
