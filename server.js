const express = require("express");
const mysql = require("mysql2/promise");
const http = require("http");
const { Server } = require("socket.io");
const config = require("./config");

const app = express();
app.use(express.json());
app.use(express.static("public"));

// Servidor HTTP "cru" por baixo do Express, necessário pro socket.io
// conseguir se anexar e manter conexões abertas com os clientes.
const server = http.createServer(app);
const io = new Server(server);

io.on("connection", (socket) => {
  // Nada de especial a fazer aqui por enquanto, mas é útil pra debug
  // saber quantas pessoas estão vendo a página em tempo real.
  console.log(`Cliente conectado (${io.engine.clientsCount} online)`);

  socket.on("disconnect", () => {
    console.log(`Cliente saiu (${io.engine.clientsCount} online)`);
  });
});

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 5,
});

// Gera todas as combinacoes de indices de tamanho "k" a partir de "n"
// indices possiveis (0..n-1). Usado pra testar toda divisao possivel
// de times do mesmo tamanho e achar a mais equilibrada em pontos.
function* combinacoesIndices(n, k, inicio = 0, atual = []) {
  if (atual.length === k) {
    yield [...atual];
    return;
  }
  for (let i = inicio; i <= n - (k - atual.length); i++) {
    atual.push(i);
    yield* combinacoesIndices(n, k, i + 1, atual);
    atual.pop();
  }
}

// Conta quantas combinacoes C(n, k) existem, sem estourar Number
// pra numeros grandes (usado so pra decidir se vale a pena testar
// TODAS as combinacoes ou fazer uma busca aleatoria).
function contarCombinacoes(n, k) {
  k = Math.min(k, n - k);
  let resultado = 1;
  for (let i = 0; i < k; i++) {
    resultado = (resultado * (n - i)) / (i + 1);
    if (resultado > 500000) return Infinity;
  }
  return Math.round(resultado);
}

// Distribui os jogadores em dois times SEMPRE do mesmo tamanho
// (ex: 5x5), buscando entre todas as divisoes possiveis aquela com a
// menor diferenca de pontos entre os times. Quando o numero de
// jogadores e impar, um time fica com um jogador a mais (aleatorio
// qual dos dois). Em caso de empate na diferenca de pontos, sorteia
// entre as melhores opcoes pra nao ficar sempre o mesmo resultado.
function sortearTimes(jogadores) {
  const n = jogadores.length;
  const menor = Math.floor(n / 2);
  const maior = n - menor;
  const aRecebeExtra = Math.random() < 0.5;
  const tamanhoA = aRecebeExtra ? maior : menor;

  const totalPontos = jogadores.reduce((s, j) => s + j.points, 0);

  const testarTodas = contarCombinacoes(n, tamanhoA) <= 500000;

  let melhorDiff = Infinity;
  let melhoresCombos = [];

  if (testarTodas) {
    for (const combo of combinacoesIndices(n, tamanhoA)) {
      const somaA = combo.reduce((s, i) => s + jogadores[i].points, 0);
      const diff = Math.abs(somaA - (totalPontos - somaA));
      if (diff < melhorDiff) {
        melhorDiff = diff;
        melhoresCombos = [combo];
      } else if (diff === melhorDiff) {
        melhoresCombos.push(combo);
      }
    }
  } else {
    // Times grandes demais pra testar todas as combinacoes: faz uma
    // busca aleatoria com muitas tentativas e fica com a melhor.
    const indices = jogadores.map((_, i) => i);
    for (let t = 0; t < 20000; t++) {
      const embaralhados = [...indices].sort(() => Math.random() - 0.5);
      const combo = embaralhados.slice(0, tamanhoA);
      const somaA = combo.reduce((s, i) => s + jogadores[i].points, 0);
      const diff = Math.abs(somaA - (totalPontos - somaA));
      if (diff < melhorDiff) {
        melhorDiff = diff;
        melhoresCombos = [combo];
      } else if (diff === melhorDiff) {
        melhoresCombos.push(combo);
      }
    }
  }

  const escolhido = melhoresCombos[Math.floor(Math.random() * melhoresCombos.length)];
  const indicesA = new Set(escolhido);

  const timeA = jogadores.filter((_, i) => indicesA.has(i));
  const timeB = jogadores.filter((_, i) => !indicesA.has(i));
  const somaA = timeA.reduce((s, j) => s + j.points, 0);
  const somaB = timeB.reduce((s, j) => s + j.points, 0);

  return { timeA, timeB, somaA, somaB };
}

// ---------------- AVATARES (STEAM API) ----------------

// Cache simples em memória: evita bater na API da Steam toda hora
// (ela tem limite de chamadas). Cada avatar fica guardado por 30 min.
const avatarCache = new Map(); // steam_id -> { url, expira }
const AVATAR_CACHE_MS = 30 * 60 * 1000;

// Busca avatares de uma lista de steam_ids, usando cache quando possivel
// e so chamando a API da Steam pelos que faltam (em lotes de 100, que e
// o maximo aceito por chamada).
async function buscarAvatares(steamIds) {
  const agora = Date.now();
  const resultado = {};
  const faltando = [];

  for (const id of steamIds) {
    const cache = avatarCache.get(id);
    if (cache && cache.expira > agora) {
      resultado[id] = cache.url;
    } else {
      faltando.push(id);
    }
  }

  if (!faltando.length || !config.steamApiKey) return resultado;

  // A API da Steam aceita no maximo 100 steamids por chamada.
  for (let i = 0; i < faltando.length; i += 100) {
    const lote = faltando.slice(i, i + 100);
    try {
      const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${config.steamApiKey}&steamids=${lote.join(",")}`;
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const data = await resp.json();
      const players = data?.response?.players || [];
      for (const p of players) {
        const avatarUrl = p.avatarfull || p.avatarmedium || p.avatar || null;
        if (avatarUrl) {
          resultado[p.steamid] = avatarUrl;
          avatarCache.set(p.steamid, { url: avatarUrl, expira: agora + AVATAR_CACHE_MS });
        }
      }
    } catch (err) {
      console.error("Erro ao buscar avatares na Steam API:", err.message);
    }
  }

  return resultado;
}



app.get("/api/leaderboard", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT steam_id, name, points, `rank` FROM rank_mix_k4ranks ORDER BY points DESC LIMIT ?",
      [config.leaderboardLimit]
    );
    const avatares = await buscarAvatares(rows.map((r) => r.steam_id));
    const comAvatar = rows.map((r) => ({ ...r, avatar_url: avatares[r.steam_id] || null }));
    res.json(comAvatar);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar o ranking." });
  }
});

// Lista de jogadores para o seletor do sorteio (busca opcional por nome).
app.get("/api/players", async (req, res) => {
  try {
    const busca = req.query.q ? `%${req.query.q}%` : "%";
    const [rows] = await pool.query(
      "SELECT steam_id, name, points FROM rank_mix_k4ranks WHERE name LIKE ? ORDER BY points DESC LIMIT 200",
      [busca]
    );
    const avatares = await buscarAvatares(rows.map((r) => r.steam_id));
    const comAvatar = rows.map((r) => ({ ...r, avatar_url: avatares[r.steam_id] || null }));
    res.json(comAvatar);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar jogadores." });
  }
});

// Impede que dois sorteios rodem ao mesmo tempo (ex: duas pessoas
// clicando "Sortear" quase junto), o que bagunçaria o que todo mundo vê.
let sorteioEmAndamento = false;

app.post("/api/draft", async (req, res) => {
  try {
    if (sorteioEmAndamento) {
      return res.status(409).json({ error: "Já tem um sorteio em andamento. Aguarde terminar." });
    }

    const jogadores = req.body.jogadores;

    if (!Array.isArray(jogadores) || jogadores.length < 2) {
      return res.status(400).json({ error: "Selecione pelo menos 2 jogadores para sortear." });
    }

    sorteioEmAndamento = true;

    // Calcula o resultado UMA VEZ no servidor (nunca no navegador de
    // cada pessoa), pra garantir que todo mundo veja o mesmo time.
    const resultado = sortearTimes(jogadores);

    // Avisa todo mundo conectado que o sorteio começou, pra tela deles
    // mostrar a animação/roleta em vez de aparecer o resultado do nada.
    io.emit("sorteio:iniciado", { jogadores });

    // Segura um pouco antes de revelar o resultado, só pra dar tempo da
    // animação de "sorteando..." rodar na tela de todo mundo.
    setTimeout(() => {
      io.emit("sorteio:resultado", resultado);
      sorteioEmAndamento = false;
    }, 3000);

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    sorteioEmAndamento = false;
    res.status(500).json({ error: "Erro ao sortear os times." });
  }
});

// Sorteia um mapa aleatório dentre a lista marcada.
function sortearMapa(mapas) {
  const indice = Math.floor(Math.random() * mapas.length);
  return mapas[indice];
}

// Impede que dois sorteios de mapa rodem ao mesmo tempo.
let mapaSorteioEmAndamento = false;

app.post("/api/draft-mapa", async (req, res) => {
  try {
    if (mapaSorteioEmAndamento) {
      return res.status(409).json({ error: "Já tem um sorteio de mapa em andamento. Aguarde terminar." });
    }

    const mapas = req.body.mapas;

    if (!Array.isArray(mapas) || mapas.length < 1) {
      return res.status(400).json({ error: "Selecione pelo menos 1 mapa para sortear." });
    }

    mapaSorteioEmAndamento = true;

    // Calculado uma única vez no servidor, pra todo mundo ver o mesmo mapa.
    const mapaId = sortearMapa(mapas);

    io.emit("mapa:iniciado", { mapas });

    setTimeout(() => {
      io.emit("mapa:resultado", { mapaId });
      mapaSorteioEmAndamento = false;
    }, 3000);

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    mapaSorteioEmAndamento = false;
    res.status(500).json({ error: "Erro ao sortear o mapa." });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Mix Dashboard rodando em http://localhost:${PORT}`);
});
