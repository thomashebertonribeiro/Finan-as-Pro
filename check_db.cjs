const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');

async function check() {
    const db = await open({
        filename: path.join(__dirname, '../server/database.sqlite'),
        driver: sqlite3.Database
    });

    console.log('Checking tables...');
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
    console.log('Tables:', tables.map(t => t.name));

    if (tables.some(t => t.name === 'bank_profiles')) {
        console.log('bank_profiles table exists.');
        const schema = await db.all("PRAGMA table_info(bank_profiles)");
        console.log('Schema:', schema);
        const data = await db.all("SELECT * FROM bank_profiles");
        console.log('Data:', data);
    } else {
        console.log('bank_profiles table NOT FOUND.');
    }
    await db.close();
}

check().catch(console.error);
