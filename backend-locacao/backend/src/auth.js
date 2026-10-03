import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';

export function signToken(user){
  return jwt.sign({ id: user.id, name: user.name, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}

export function verifyToken(token){
  try{ return jwt.verify(token, JWT_SECRET); }
  catch(err){ return null; }
}

export function signTeamToken(teamId){
  return jwt.sign({ teamId, role: 'team' }, JWT_SECRET, { expiresIn: '180d' });
}

export function teamAuthMiddleware(req, res, next){
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if(!token) return res.status(401).json({ error: 'Não autenticado.' });
  const payload = verifyToken(token);
  if(!payload || payload.role !== 'team' || !payload.teamId){
    return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  }
  req.team = payload;
  next();
}
export function authMiddleware(req, res, next){
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if(!token) return res.status(401).json({ error: 'Não autenticado.' });
  const payload = verifyToken(token);
  if(!payload) return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  req.user = payload;
  next();
}

export { JWT_SECRET };

// Papéis: admin (tudo) | gerente (logística: agenda, equipes, mapa) | comercial (locações e clientes)
export const ROLES = ['admin', 'gerente', 'comercial'];

// Libera leitura para todos os usuários logados; escrita só para os papéis listados (admin sempre pode)
export function allowWrite(...roles){
  return (req, res, next) => {
    if(req.method === 'GET') return next();
    if(req.user?.role === 'admin' || roles.includes(req.user?.role)) return next();
    const quem = roles.map(r => ({ gerente: 'gerente de logística', comercial: 'equipe comercial' }[r] || r)).join(' ou ');
    return res.status(403).json({ error: `Só ${quem} ou administrador pode fazer essa alteração.` });
  };
}
