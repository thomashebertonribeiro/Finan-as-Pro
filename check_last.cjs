const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

async function checkLastTransactions() {
    const db = await open({
        filename: path.join(__dirname, 'server', 'database.sqlite'),
        driver: sqlite3.Database
    });

    const rows = await db.all('SELECT * FROM transactions ORDER BY id DESC LIMIT 5');
    console.log('--- Últimas 5 Transações ---');
    console.table(rows);
    await db.close();
}

checkLastTransactions().catch(console.error);
