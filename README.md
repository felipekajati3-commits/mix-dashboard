# Mix Dashboard

Site com ranking público (pontos do K4-System) e sorteio de times balanceados
a partir de quem está online agora no servidor.

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

- **Aba Ranking**: lê a tabela `rank_mix_k4ranks` do banco e mostra todo
  mundo ordenado por pontos, do maior pro menor.
- **Aba Sorteio**: mostra a lista de jogadores registrados no K4 (com
  busca por nome). Você marca quem vai jogar hoje e clica em "Sortear
  times" — ele distribui todo mundo em dois times tentando deixar a
  SOMA DE PONTOS de cada lado o mais parecida possível (jogadores com
  pontuação empatada são embaralhados aleatoriamente antes, então o
  sorteio não fica sempre igual).

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
