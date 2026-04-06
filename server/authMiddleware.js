const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_JWT_SECRET) {
    console.error('❌ [CRITICAL] SUPABASE_JWT_SECRET não está definido. O servidor não pode validar tokens JWT.');
    throw new Error('SUPABASE_JWT_SECRET é obrigatório para iniciar o servidor.');
}

function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token de autenticação ausente' });
    }

    const token = authHeader.slice(7);

    let payload;
    try {
        payload = jwt.verify(token, SUPABASE_JWT_SECRET);
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expirado. Faça login novamente.' });
        }
        return res.status(401).json({ error: 'Token inválido' });
    }

    req.userId = payload.sub;

    req.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } }
    });

    next();
}

module.exports = authMiddleware;
