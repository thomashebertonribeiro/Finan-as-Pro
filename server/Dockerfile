FROM node:20-slim

WORKDIR /app

# Copia apenas arquivos de dependências primeiro (cache de layers)
COPY package*.json ./
RUN npm install --omit=dev

# Copia o código da aplicação
COPY . .

# Diretório de uploads temporários
RUN mkdir -p /app/uploads

# Diretório de sessão do Baileys — persistido via volume Docker
VOLUME /app/auth_info_baileys

EXPOSE 3002

CMD ["node", "index.js"]
