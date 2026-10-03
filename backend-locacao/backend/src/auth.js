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
