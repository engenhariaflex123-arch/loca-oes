import express from 'express';
import 'express-async-errors'; // erros em rotas async viram resposta 500 em vez de derrubar o servidor
import cors from 'cors';
import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { pool } from './db.js';
import { authMiddleware } from './auth.js';

import clientsRouter from './routes/clients.js';
import taskTypesRouter from './routes/taskTypes.js';
import appointmentsRouter from './routes/appointments.js';
import teamMembersRouter from './routes/teamMembers.js';
import settingsRouter from './routes/settings.js';
import authRouter from './routes/auth.js';
import auditLogRouter from './routes/auditLog.js';
import teamAppRouter from './routes/teamApp.js';
import sitesRouter from './routes/sites.js';
import productTypesRouter from './routes/productTypes.js';
import assetsRouter from './routes/assets.js';
import rentalsRouter from './routes/rentals.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

if(!process.env.JWT_SECRET){
  console.warn('ATENÇÃO: JWT_SECRET não definido. Configure essa variável no Railway antes de usar em produção.');
}

app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.options('*', cors());
app.use(express.json({ limit: '25mb' }));

app.get('/', (req, res) => res.json({ status: 'ok', service: 'logistica-backend' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRouter);
app.use('/api/team-app', teamAppRouter);

app.use('/api/clients', authMiddleware, clientsRouter);
app.use('/api/task-types', authMiddleware, taskTypesRouter);
app.use('/api/appointments', authMiddleware, appointmentsRouter);
app.use('/api/team-members', authMiddleware, teamMembersRouter);
app.use('/api/settings', authMiddleware, settingsRouter);
app.use('/api/audit-log', authMiddleware, auditLogRouter);
app.use('/api/sites', authMiddleware, sitesRouter);
app.use('/api/product-types', authMiddleware, productTypesRouter);
app.use('/api/assets', authMiddleware, assetsRouter);
app.use('/api/rentals', authMiddleware, rentalsRouter);

// Tratamento central de erros
app.use((err, req, res, next) => {
  if(err.status){
    return res.status(err.status).json({ error: err.message, ...(err.details || {}) });
  }
  if(err.code === '23503') return res.status(409).json({ error: 'Referência inválida ou registro em uso por outros dados.' });
  if(err.code === '23505') return res.status(409).json({ error: 'Já existe um registro com esse valor (ex.: código repetido).' });
  if(err.code === '23514') return res.status(400).json({ error: 'Dados inválidos (verifique datas e quantidades).' });
  console.error(err);
  res.status(500).json({ error: 'Erro interno no servidor.' });
});

const PORT = process.env.PORT || 3001;

async function ensureSchema(){
  const sql = readFileSync(join(__dirname, '..', 'db', 'schema.sql'), 'utf-8');
  await pool.query(sql);
  console.log('Schema verificado/criado com sucesso.');
}

ensureSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`API rodando na porta ${PORT}`));
  })
  .catch(err => {
    console.error('Falha ao preparar o banco de dados:', err);
    process.exit(1);
  });
