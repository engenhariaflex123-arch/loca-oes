# Frontend: o que mudou para locação

Arquivos novos:
- `src/constants.js`: equipes, status, tipos de visita e formatação (R$, datas). `TEAMS` saiu do App.jsx e veio para cá.
- `src/locacoes.jsx`: aba **Locações** (lista, formulário com estoque livre ao vivo, detalhe, confirmar/cancelar/encerrar, locais de instalação).
- `src/estoque.jsx`: aba **Estoque** (resumo por status, unidades com patrimônio, cadastro em lote, histórico, catálogo de produtos).

Arquivos alterados:
- `src/api.js`: endpoints novos; erros agora trazem `err.body` (ex.: lista do que falta no estoque).
- `src/App.jsx`:
  - abas Locações e Estoque (Locações abre por padrão);
  - Agenda mostra o tipo da visita (Entrega, Limpeza, Retirada...) e visitas não realizadas;
  - o modal da Agenda mostra local e itens da locação e não apaga esses dados ao salvar;
  - o registro de execução mostra as unidades entregues/recolhidas e quem recebeu;
  - Mapa, rotas, sugestão semanal e relatórios usam o endereço do evento (função `stopOf`), não o do cliente;
  - o tempo estimado de visitas sem tarefas vem do catálogo (minutos de montagem/retirada por unidade).

Antes de publicar, troque `public/logo.png` e o `<title>` do `index.html`, que ainda são da outra empresa.
