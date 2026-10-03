import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { pool } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate(){
  const sql = readFileSync(join(__dirname, '..', 'db', 'schema.sql'), 'utf-8');
  await pool.query(sql);
  console.log('Migração concluída: tabelas criadas/verificadas.');
  await pool.end();
}

migrate().catch(err => {
  console.error('Erro na migração:', err);
  process.exit(1);
});
