# Estágio 1: Build
FROM node:20-alpine AS build

WORKDIR /app

# Aceita variáveis de build
ARG VITE_API_URL
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
# Valida variáveis obrigatórias
RUN test -n "$VITE_API_URL" || (echo "ERRO: VITE_API_URL não definida." && exit 1)
RUN test -n "$VITE_SUPABASE_URL" || (echo "ERRO: VITE_SUPABASE_URL não definida." && exit 1)
RUN test -n "$VITE_SUPABASE_ANON_KEY" || (echo "ERRO: VITE_SUPABASE_ANON_KEY não definida." && exit 1)
# Expõe como ENV para o Vite processar durante o build
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

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
