# Mix Dashboard

Site com ranking por níveis (Rank 1 a 5, definido pela equipe no painel de
admin), sorteio de times balanceados e sorteio de mapa.

## O que você precisa antes de rodar

1. **Node.js instalado** (baixe em nodejs.org, versão LTS)

## Instalação

```
cd mix-dashboard
npm install
```

## Configuração

Os dados do banco (`config.js`) já vêm preenchidos com os que você me
passou. Não precisa mexer em nada antes de rodar.

## Rodando

```
npm start
```

Depois abra `http://localhost:3000` no navegador (ou o IP da máquina
onde você rodou, se outras pessoas forem acessar pela rede).

## Como funciona

- **Aba Ranking**: leaderboard oficial do **K4-System**, o plugin de
  pontos do servidor. Vem direto da tabela `rank_mix_k4ranks` (rota
  `/api/leaderboard`), ordenado por pontos — ninguém precisa cadastrar
  nada manualmente pra alguém aparecer aqui. Mostra posição, nome e
  pontos, com cor mudando por faixa (igual ao Premier do CS2): cinza
  até 4999, azul claro a partir de 5000, azul a partir de 10000, roxo
  a partir de 15000, rosa a partir de 20000, vermelho a partir de
  25000 e dourado a partir de 30000 (as faixas ficam em
  `FAIXAS_PREMIER`, no topo de `public/app.js`, caso queira mudar os
  valores). O tamanho da lista é controlado por `leaderboardLimit` em
  `config.js` (padrão: 50).
- **Aba Sorteio**: continua usando os níveis manuais (Rank 1 a 5)
  definidos pela equipe em `/admin.html` — é isso que serve pra montar
  times equilibrados (pesos em `pesosPorTier`, no `config.js`). Essa
  lista é **independente** da aba Ranking agora. Nas vagas "Complete N"
  existe um lápis para trocar o nome só para os sorteios.
- **Aba Mapa**: sorteio de mapa ao vivo.
- **Aba Temporadas**: ranking final de cada mês, guardado de forma
  permanente (arquivo `temporadas.json` na branch `data`, via
  `temporadas.js`). Mostra um seletor de mês, o campeão e a tabela
  completa daquela temporada, com o mesmo visual do Ranking. As
  temporadas são fechadas assim:
  - **Pelo admin** (`/admin.html` → "Temporadas"): escolha o mês e a
    fonte (snapshot atual, snapshot anterior ou ranking ao vivo). É o
    jeito certo de guardar um mês cujo reset já foi feito, usando o
    snapshot tirado antes do reset.
  - **Automático**: no último dia do mês, a partir das 23:50 (Brasília),
    o site guarda o ranking ao vivo como a temporada do mês — mas só se
    o mês ainda não existir e o ranking não estiver zerado. Isso exige o
    site acordado nessa janela (no Render grátis ele dorme): configure um
    cron externo para chamar todo dia às 23:55 (Brasília)
    `https://SEU-SITE/api/cron/fechar-temporada?key=SUA_CRON_SECRET`
    (defina a variável `CRON_SECRET` no host; sem ela a rota fica
    desligada). Em dias que não são o último do mês a chamada não faz nada.
  - O site **não zera os pontos** no K4-System: o reset continua sendo
    feito por você. Fluxo mensal: tire o snapshot / deixe o automático
    fechar → confira em "Temporadas" → faça o reset.
- **/admin.html**: onde a equipe edita os níveis usados no Sorteio (e só
  nele — não afeta mais a aba Ranking).

A busca por nome do painel de admin (`/api/players`) também lê a tabela
do K4, pra achar o Steam ID de quem já jogou no servidor.

## Hospedar para todo mundo acessar (não só você)

Rodando assim, só você consegue acessar (`localhost`). Para os seus
amigos acessarem de fora, você precisa hospedar isso em algum lugar
com IP público — por exemplo:

- Uma VPS barata (o próprio host da FireGamesNetwork pode oferecer, ou
  serviços como Hetzner, DigitalOcean, Railway, Render)
- Ou, se você já tem acesso root/SSH no seu próprio servidor de jogo,
  rodar ali mesmo, em outra porta

Isso foge do escopo deste guia — me avise se quiser ajuda para colocar
no ar publicamente, tem algumas formas simples (ex: Railway ou Render
têm planos gratuitos que rodam isso em poucos cliques).

## Segurança

Este projeto guarda a senha do banco e a senha de RCON em texto puro no
`config.js`. Isso é aceitável rodando localmente na sua máquina, mas
**nunca suba esse arquivo pra um repositório público no GitHub** nem
compartilhe ele com estranhos.
