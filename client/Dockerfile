# Estágio 1: Build
FROM node:20-alpine AS build

WORKDIR /app

# Aceita a URL do backend como argumento de build
ARG VITE_API_URL
# Valida que a variável foi fornecida
RUN test -n "$VITE_API_URL" || (echo "ERRO: VITE_API_URL não definida. Defina o build argument no Coolify." && exit 1)
# Expõe como ENV para o Vite processar durante o build
ENV VITE_API_URL=$VITE_API_URL

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Estágio 2: Servir com Nginx
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
