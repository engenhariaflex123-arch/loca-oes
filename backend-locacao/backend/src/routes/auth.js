import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { signToken, authMiddleware, verifyToken } from '../auth.js';
import { logAudit } from '../audit.js';

const router = Router();

function uid(){ return Math.random().toString(36).slice(2,10) + Date.now().toString(36); }

router.post('/register', async (req, res) => {
  const { name, email, password, role } = req.body;
  if(!name || !email || !password || !role){
    return res.status(400).json({ error: 'Preencha nome, e-mail, senha e cargo.' });
  }
  if(!['gerente', 'admin'].includes(role)){
    return res.status(400).json({ error: 'Cargo inválido.' });
  }
  if(password.length < 6){
    return res.status(400).json({ error: 'A senha precisa ter pelo menos 6 caracteres.' });
  }
  try{
    const countRes = await pool.query('SELECT COUNT(*)::int AS count FROM users');
    const userCount = countRes.rows[0].count;

    if(userCount > 0){
      // Not the founding account — only a logged-in admin can create new accounts.
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : null;
      const requester = token ? verifyToken(token) : null;
      if(!requester || requester.role !== 'admin'){
        return res.status(403).json({ error: 'Somente um administrador logado pode criar novas contas. Peça para um administrador te cadastrar na aba Usuários.' });
      }
    }

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if(existing.rows.length > 0){
      return res.status(409).json({ error: 'Já existe uma conta com esse e-mail.' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const id = uid();
    await pool.query(
      'INSERT INTO users (id, name, email, password_hash, role) VALUES ($1,$2,$3,$4,$5)',
      [id, name.trim(), email.toLowerCase().trim(), passwordHash, role]
    );
    const user = { id, name: name.trim(), email: email.toLowerCase().trim(), role };
    await logAudit(user, 'register', 'auth', user.name);
    const token = signToken(user);
    res.status(201).json({ token, user });
  }catch(err){
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar conta.' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if(!email || !password) return res.status(400).json({ error: 'Preencha e-mail e senha.' });
  try{
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    const row = rows[0];
    if(!row) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    const valid = await bcrypt.compare(password, row.password_hash);
    if(!valid) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    const user = { id: row.id, name: row.name, email: row.email, role: row.role };
    await logAudit(user, 'login', 'auth', user.name);
    const token = signToken(user);
    res.json({ token, user });
  }catch(err){
    console.error(err);
    res.status(500).json({ error: 'Erro ao entrar.' });
  }
});

router.get('/users', authMiddleware, async (req, res) => {
  if(req.user.role !== 'admin'){
    return res.status(403).json({ error: 'Somente administradores podem ver essa lista.' });
  }
  const { rows } = await pool.query('SELECT id, name, email, role, created_at FROM users ORDER BY created_at ASC');
  res.json(rows);
});

router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

export default router;
