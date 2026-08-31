const express = require("express");
const mysql = require("mysql2/promise");
const http = require("http");
const { Server } = require("socket.io");
const { Rcon } = require("rcon-client");
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
  io.emit("online:count", io.engine.clientsCount);

  socket.on("disconnect", () => {
    console.log(`Cliente saiu (${io.engine.clientsCount} online)`);
    io.emit("online:count", io.engine.clientsCount);
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

// ---------------- HISTÓRICO DE SORTEIOS (em memória) ----------------
// Guardado só na memória do servidor (não no banco) e filtrado pra
// mostrar apenas os sorteios de "hoje" - reseta sozinho todo dia,
// e também some se o servidor reiniciar (não precisa durar muito).
let historicoSorteios = []; // { criado_em: Date, timeA, timeB, somaA, somaB }

function mesmoDia(a, b) {
  return a.toDateString() === b.toDateString();
}

// Remove do array qualquer sorteio que não seja de hoje, pra não
// acumular memória à toa com o passar dos dias.
function limparHistoricoAntigo() {
  const agora = new Date();
  historicoSorteios = historicoSorteios.filter((h) => mesmoDia(h.criado_em, agora));
}

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
      `SELECT r.steam_id, r.name, r.points, r.\`rank\`,
              COALESCE(s.kills, 0) AS kills,
              COALESCE(s.deaths, 0) AS deaths,
              COALESCE(s.headshots, 0) AS headshots
       FROM rank_mix_k4ranks r
       LEFT JOIN rank_mix_k4stats s ON s.steam_id = r.steam_id
       ORDER BY r.points DESC
       LIMIT ?`,
      [config.leaderboardLimit]
    );
    const comStats = rows.map((r) => ({
      ...r,
      hs_pct: r.kills > 0 ? Math.round((r.headshots / r.kills) * 100) : 0,
    }));
    const avatares = await buscarAvatares(comStats.map((r) => r.steam_id));
    const comAvatar = comStats.map((r) => ({ ...r, avatar_url: avatares[r.steam_id] || null }));
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

// Guarda o time de cada steam_id do sorteio mais recente, pra o plugin do
// servidor de CS2 poder consultar "esse jogador caiu em qual time?" quando
// ele entrar. Fica só em memória (reinicia quando o site reinicia).
let ultimoSorteioTimes = null;

// Avisa o servidor de CS2, na hora, sobre o time de cada jogador do sorteio
// mais recente — assim o plugin já sabe pra onde mandar cada um assim que
// ele conectar, sem precisar esperar uma chamada HTTP nesse momento (o que
// causava a tela de escolha de time aparecer antes da troca automática).
// Se o RCON falhar por qualquer motivo, não trava o site — o plugin ainda
// tem, como reserva, a forma antiga (consultar a API) de descobrir o time.
async function avisarServidorSobreSorteio(ctSteamIds, tSteamIds) {
  if (!config.rcon.host || !config.rcon.password) {
    console.warn("[RCON] Dados de RCON não configurados — pulando aviso ao servidor.");
    return;
  }

  const listaOuVazio = (lista) => (lista.length ? lista.join(",") : "_");
  const comando = `mixdash_settimes "${listaOuVazio(ctSteamIds)}" "${listaOuVazio(tSteamIds)}"`;

  let rcon;
  try {
    rcon = await Rcon.connect({
      host: config.rcon.host,
      port: config.rcon.port,
      password: config.rcon.password,
      timeout: 4000,
    });
    await rcon.send(comando);
    console.log("[RCON] Times do sorteio enviados pro servidor com sucesso.");
  } catch (err) {
    console.warn("[RCON] Não consegui avisar o servidor sobre o sorteio:", err.message);
  } finally {
    if (rcon) {
      try {
        await rcon.end();
      } catch {
        // já desconectado ou com erro, não tem o que fazer aqui
      }
    }
  }
}

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

      // Guarda o resultado no histórico do dia (em memória), pra dar
      // pra consultar e ajudar a não repetir sempre a mesma combinação.
      const timeANomes = resultado.timeA.map((j) => ({ steam_id: j.steam_id, name: j.name }));
      const timeBNomes = resultado.timeB.map((j) => ({ steam_id: j.steam_id, name: j.name }));
      historicoSorteios.push({
        criado_em: new Date(),
        timeA: timeANomes,
        timeB: timeBNomes,
        somaA: resultado.somaA,
        somaB: resultado.somaB,
      });
      limparHistoricoAntigo();

      // Time A entra como CT, Time B como T no servidor de CS2. Guarda
      // por steam_id (como string) pra bater certinho com o que o
      // plugin do jogo manda.
      ultimoSorteioTimes = {
        criado_em: new Date(),
        ctSteamIds: timeANomes.map((j) => String(j.steam_id)),
        tSteamIds: timeBNomes.map((j) => String(j.steam_id)),
      };

      // Manda pro servidor na hora — não precisa esperar, roda em segundo
      // plano (por isso não tem "await" aqui).
      avisarServidorSobreSorteio(ultimoSorteioTimes.ctSteamIds, ultimoSorteioTimes.tSteamIds);
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

// Retorna os sorteios de hoje, mais recente primeiro.
app.get("/api/draft-history", (req, res) => {
  limparHistoricoAntigo();
  const ordenado = [...historicoSorteios].sort((a, b) => b.criado_em - a.criado_em);
  res.json(ordenado);
});

// Usado pelo plugin do servidor de CS2 pra saber em qual time colocar um
// jogador assim que ele entra, de acordo com o sorteio mais recente feito
// no site. Protegido por uma senha simples (compartilhada com o plugin),
// já que não precisa de login de usuário — só o servidor de jogo chama isso.
app.get("/api/plugin/time/:steam_id", (req, res) => {
  const segredoRecebido = req.header("x-plugin-secret");
  if (!segredoRecebido || segredoRecebido !== config.pluginSecret) {
    return res.status(401).json({ error: "Não autorizado." });
  }

  if (!ultimoSorteioTimes) {
    return res.json({ team: null });
  }

  const steamId = String(req.params.steam_id);
  if (ultimoSorteioTimes.ctSteamIds.includes(steamId)) {
    return res.json({ team: "CT" });
  }
  if (ultimoSorteioTimes.tSteamIds.includes(steamId)) {
    return res.json({ team: "T" });
  }
  return res.json({ team: null });
});

// Guarda o resultado da última partida (quem ganhou, o placar), recebido
// via webhook do próprio MatchZy quando a série termina.
let ultimoResultadoPartida = null;

// Chamado pelo MatchZy (configurado via matchzy_remote_log_url) toda vez
// que qualquer evento de partida acontece. A gente só se importa com o
// evento "series_end" (fim da partida) — os outros são só confirmados
// com 200 OK e ignorados, pra não fazer o MatchZy ficar tentando de novo.
app.post("/api/matchzy/evento", (req, res) => {
  const segredoRecebido = req.header("x-plugin-secret");
  if (!segredoRecebido || segredoRecebido !== config.pluginSecret) {
    return res.status(401).json({ error: "Não autorizado." });
  }

  const evento = req.body;

  if (evento.event !== "series_end") {
    return res.json({ ok: true });
  }

  // O MatchZy chama de "team1" o time que começou do lado CT e "team2" o
  // que começou do lado T (o nosso plugin já coloca Time A na CT e Time B
  // na T ao entrar). Então: team1 = Time A, team2 = Time B.
  let vencedor = null;
  if (evento.winner?.team === "team1") vencedor = "A";
  else if (evento.winner?.team === "team2") vencedor = "B";

  ultimoResultadoPartida = {
    criado_em: new Date(),
    vencedor, // "A" | "B" | null (null = empate ou sem vencedor)
    placarA: evento.team1_series_score ?? null,
    placarB: evento.team2_series_score ?? null,
  };

  // Se ainda tiver o sorteio dessa rodada no histórico do dia, anexa o
  // resultado nele também, pra aparecer junto na lista de sorteios de hoje.
  if (historicoSorteios.length > 0) {
    historicoSorteios[historicoSorteios.length - 1].resultado = ultimoResultadoPartida;
  }

  io.emit("partida:resultado", ultimoResultadoPartida);

  res.json({ ok: true });
});

// Estatísticas detalhadas de um único jogador (usado no modal de perfil).
app.get("/api/player/:steam_id", async (req, res) => {
  try {
    const { steam_id } = req.params;
    const [rows] = await pool.query(
      `SELECT r.steam_id, r.name, r.points, r.\`rank\`,
              COALESCE(s.kills, 0) AS kills,
              COALESCE(s.deaths, 0) AS deaths,
              COALESCE(s.assists, 0) AS assists,
              COALESCE(s.headshots, 0) AS headshots,
              COALESCE(s.mvp, 0) AS mvp,
              COALESCE(s.shoots, 0) AS shoots,
              COALESCE(s.hits_given, 0) AS hits_given,
              COALESCE(s.round_win, 0) AS round_win,
              COALESCE(s.round_lose, 0) AS round_lose,
              COALESCE(s.game_win, 0) AS game_win,
              COALESCE(s.game_lose, 0) AS game_lose,
              COALESCE(s.bomb_planted, 0) AS bomb_planted,
              COALESCE(s.bomb_defused, 0) AS bomb_defused
       FROM rank_mix_k4ranks r
       LEFT JOIN rank_mix_k4stats s ON s.steam_id = r.steam_id
       WHERE r.steam_id = ?
       LIMIT 1`,
      [steam_id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Jogador não encontrado." });
    }

    const j = rows[0];
    const totalJogos = j.game_win + j.game_lose;
    const perfil = {
      ...j,
      hs_pct: j.kills > 0 ? Math.round((j.headshots / j.kills) * 100) : 0,
      kd: j.deaths > 0 ? Math.round((j.kills / j.deaths) * 100) / 100 : j.kills,
      win_rate: totalJogos > 0 ? Math.round((j.game_win / totalJogos) * 100) : 0,
      accuracy: j.shoots > 0 ? Math.round((j.hits_given / j.shoots) * 100) : 0,
    };

    const avatares = await buscarAvatares([steam_id]);
    perfil.avatar_url = avatares[steam_id] || null;

    res.json(perfil);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar perfil do jogador." });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Mix Dashboard rodando em http://localhost:${PORT}`);
});
