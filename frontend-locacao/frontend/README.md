# Plataforma de Logística

Monorepo simples com duas pastas:

- `backend/` — API em Node/Express + Postgres (Railway)
- `frontend/` — App em React/Vite (Vercel)

## 1. Subir para o seu GitHub

```bash
cd logistica-platform
git init
git add .
git commit -m "Primeira versão da plataforma"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/logistica-platform.git
git push -u origin main
```

(Crie o repositório vazio antes no GitHub, sem README, e troque `SEU-USUARIO` pelo seu usuário.)

## 2. Backend no Railway

1. No Railway, **New Project → Deploy from GitHub repo** e selecione este repositório.
2. Em **Settings → Root Directory**, defina `backend`.
3. Clique em **+ New → Database → Add PostgreSQL** dentro do mesmo projeto.
   O Railway injeta automaticamente a variável `DATABASE_URL` no serviço do backend — não precisa configurar nada manualmente.
4. O backend já cria as tabelas sozinho na primeira vez que sobe (`ensureSchema()` roda no boot).
5. Depois do deploy, copie a URL pública gerada pelo Railway (algo como `https://logistica-backend-production.up.railway.app`).

## 3. Frontend no Vercel

1. No Vercel, **Add New → Project** e importe o mesmo repositório.
2. Em **Root Directory**, selecione `frontend`.
3. Framework preset: **Vite**.
4. Em **Environment Variables**, adicione:
   - `VITE_API_URL` = a URL pública do backend do passo anterior (sem barra no final)
5. Deploy.

## 4. Testando localmente (opcional)

Backend:
```bash
cd backend
cp .env.example .env    # edite com seu Postgres local ou de testes
npm install
npm run migrate         # cria as tabelas
npm start
```

Frontend (em outro terminal):
```bash
cd frontend
cp .env.example .env    # aponte para http://localhost:3001
npm install
npm run dev
```

## Próximos passos

- Autenticação de usuários (login por gestor/operador)
- Módulo de rotas otimizadas por equipe (integra com o otimizador de rota feito anteriormente)
- Exportação de relatórios (histórico de cliente, produtividade por equipe)
