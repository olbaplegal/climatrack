const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
  max: 5,
});

pool.on('error', (err) => console.error('[db] erro no pool:', err.message));

// Tenta algumas vezes: o banco pode ainda estar subindo (docker recém-iniciado, Supabase "acordando")
async function migrar(tentativas = 10) {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
  for (let i = 1; ; i++) {
    try {
      await pool.query(sql);
      console.log('[db] esquema verificado');
      return;
    } catch (err) {
      if (i >= tentativas) throw err;
      console.log(`[db] banco indisponível (${err.message || err.code}), nova tentativa ${i}/${tentativas - 1} em 3 s...`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  migrar,
};
