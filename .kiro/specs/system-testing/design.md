# Design Document: System Testing

## Overview

Este documento define a estratégia e arquitetura de testes para o Finan-as-Pro, uma aplicação financeira composta por um servidor Node.js/Express com banco de dados Supabase (PostgreSQL), um cliente React/Vite, integração com WhatsApp via Baileys e processamento de imagens via Google Gemini 2.5 Flash (com fallback Tesseract.js).

O objetivo é criar uma suíte de testes abrangente que cubra as camadas de unidade, integração e end-to-end, garantindo a confiabilidade dos fluxos críticos: extração de transações via OCR/IA, persistência no banco de dados, automação via WhatsApp e operações CRUD do dashboard.

## Architecture

```mermaid
graph TD
    subgraph "Camadas de Teste"
        UT[Unit Tests<br/>Jest / Vitest]
        IT[Integration Tests<br/>Supertest + Jest]
        E2E[E2E Tests<br/>Playwright]
    end

    subgraph "Sistema Alvo"
        CLIENT[React Client<br/>Vite]
        SERVER[Express Server<br/>Node.js]
        DB[(Supabase<br/>PostgreSQL)]
        GEMINI[Gemini 2.5 Flash<br/>API]
        WA[WhatsApp<br/>Baileys]
        TESSERACT[Tesseract.js<br/>OCR Fallback]
    end

    UT -->|"utils.js, gemini-service.js"| SERVER
    IT -->|"HTTP routes via Supertest"| SERVER
    IT -->|"Supabase mock / test DB"| DB
    E2E -->|"Browser automation"| CLIENT
    CLIENT -->|"REST API"| SERVER
    SERVER -->|"Supabase client"| DB
    SERVER -->|"Vision API"| GEMINI
    SERVER -->|"WebSocket"| WA
    SERVER -->|"Fallback"| TESSERACT
```

## Sequence Diagrams

### Fluxo de Processamento de Imagem (Caminho Feliz)

```mermaid
sequenceDiagram
    participant Test as Test Suite
    participant API as Express /process-image
    participant Gemini as gemini-service.js
    participant DB as database.js (Supabase)

    Test->>API: POST /process-image (multipart/form-data)
    API->>DB: getSuppliers()
    DB-->>API: suppliers[]
    API->>Gemini: processImageWithGemini(imagePath, mimeType)
    Gemini->>DB: getSetting('gemini_api_key')
    DB-->>Gemini: apiKey
    Gemini->>DB: getBankProfiles()
    DB-->>Gemini: bankProfiles[]
    Gemini-->>API: transactions[]
    API-->>Test: 200 { data: transactions[] }
```

### Fluxo de Processamento de Imagem (Fallback Tesseract)

```mermaid
sequenceDiagram
    participant Test as Test Suite
    participant API as Express /process-image
    participant Gemini as gemini-service.js
    participant OCR as Tesseract.js
    participant Utils as utils.js

    Test->>API: POST /process-image (sem API key configurada)
    API->>Gemini: processImageWithGemini(imagePath, mimeType)
    Gemini-->>API: null (sem API key)
    API->>OCR: Tesseract.recognize(imagePath, 'por')
    OCR-->>API: { data: { text } }
    API->>Utils: parseFinancialData(text, suppliers)
    Utils-->>API: transactions[]
    API-->>Test: 200 { data: transactions[] }
```

### Fluxo WhatsApp - Mensagem de Texto

```mermaid
sequenceDiagram
    participant Test as Test Suite
    participant WA as whatsapp-service.js
    participant DB as database.js
    participant Sock as Baileys S