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

- **Aba Ranking**: mostra os jogadores em 5 colunas, uma por nível
  (Rank 1 é o mais forte, Rank 5 o mais fraco). Ao lado do nome aparece
  uma seta: ▲ verde (subiu de nível), ▼ vermelha (desceu) ou – (manteve).
  As vagas de preenchimento ("Complete 1", "Complete 2"…) não aparecem
  aqui.
- **Aba Sorteio**: você marca quem vai jogar e clica em "Sortear times".
  Os dois times saem com a soma de níveis mais equilibrada possível (pesos
  em `pesosPorTier`, no `config.js`). Nas vagas "Complete N" existe um
  lápis para trocar o nome **só para os sorteios** (não altera o ranking).
- **Aba Mapa**: sorteio de mapa ao vivo.
- **/admin.html**: onde a equipe edita os níveis. Ao salvar, o servidor
  compara cada jogador com o que estava salvo antes: quem mudou de nível
  ganha a seta na aba Ranking, e ela fica até a próxima mudança ou até
  clicar em "Zerar setas".

O K4-System não é mais usado para o ranking nem para o sorteio. A única
coisa que ainda lê a tabela antiga do K4 é a busca por nome do painel de
admin (`/api/players`), para achar o Steam ID de quem já jogou no servidor.

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
