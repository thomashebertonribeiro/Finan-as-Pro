const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

async function checkLastTransactions() {
    // Como o script roda na pasta server/, o banco está no mesmo nível
    const dbPath = path.join(__dirname, 'database.sqlite');
    console.log(`Abrindo banco em: ${dbPath}`);
    
    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    const rows = await db.all('SELECT * FROM transactions ORDER BY id DESC LIMIT 5');
    console.log('--- Últimas 5 Transações ---');
    console.table(rows);
    await db.close();
}

checkLastTransactions().catch(console.error);
