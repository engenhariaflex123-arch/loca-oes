import pg from 'pg';
import 'dotenv/config';

const { Pool, types } = pg;

// DATE volta como texto 'AAAA-MM-DD' (sem conversão de fuso, que pode "voltar" um dia)
types.setTypeParser(1082, v => v);
// NUMERIC volta como número em vez de string
types.setTypeParser(1700, v => parseFloat(v));

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : false,
});
