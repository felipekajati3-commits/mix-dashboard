const express = require("express");
const mysql = require("mysql2/promise");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const config = require("./config");
const store = require("./store");
const historico = require("./historico");
const corte = require("./corte");
const demos = require("./demos");
const snapshot = require("./snapshot");
const temporadas = require("./temporadas");

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

// Quanto um jogador "vale" pro equilibrio dos times, a partir do
// nivel (1 a 5) que voce definiu no painel de admin. Rank 1 e o
// melhor e vale mais; rank 5 e o mais fraco e vale menos.
function pesoDe(jogador) {
  return config.pesosPorTier[jogador.tier] ?? 3;
}

// Distribui os jogadores em dois times SEMPRE do mesmo tamanho
// (ex: 5x5), buscando entre todas as divisoes possiveis aquela com a
// menor diferenca de forca entre os times. Quando o numero de
// jogadores e impar, um time fica com um jogador a mais (aleatorio
// qual dos dois). Em caso de empate na diferenca, sorteia entre as
// melhores opcoes pra nao ficar sempre o mesmo resultado.
//
// A compensacao que voce descreveu ("se um time ficou com 2 rank 1,
// os 2 rank 5 vao junto") sai sozinha dessa conta - nao precisa de
// regra separada. Ex: 3 rank 1, 3 rank 2, 1 rank 3 e 3 rank 5 dao
// 16 x 17, e qualquer outra divisao fica pior que isso.
function sortearTimes(jogadores) {
  const n = jogadores.length;
  const menor = Math.floor(n / 2);
  const maior = n - menor;
  const aRecebeExtra = Math.random() < 0.5;
  const tamanhoA = aRecebeExtra ? maior : menor;

  const totalPontos = jogadores.reduce((s, j) => s + pesoDe(j), 0);

  const testarTodas = contarCombinacoes(n, tamanhoA) <= 500000;

  let melhorDiff = Infinity;
  let melhoresCombos = [];

  if (testarTodas) {
    for (const combo of combinacoesIndices(n, tamanhoA)) {
      const somaA = combo.reduce((s, i) => s + pesoDe(jogadores[i]), 0);
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
      const somaA = combo.reduce((s, i) => s + pesoDe(jogadores[i]), 0);
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
  const somaA = timeA.reduce((s, j) => s + pesoDe(j), 0);
  const somaB = timeB.reduce((s, j) => s + pesoDe(j), 0);

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



// ---------------- LOGIN DO ADMIN ----------------
// Em vez de trazer uma biblioteca de sessão, o login é um cookie
// assinado: dentro dele vai só a data de validade, e junto vai uma
// assinatura feita com o SESSION_SECRET. Sem o segredo ninguém
// consegue forjar um cookie válido, e o servidor não precisa guardar
// nada na memória (o que sobrevive a restart do Render).

function assinar(valor) {
  return crypto.createHmac("sha256", config.sessionSecret).update(valor).digest("hex");
}

function criarTokenAdmin() {
  const expiraEm = String(Date.now() + config.sessionHoras * 60 * 60 * 1000);
  return `${expiraEm}.${assinar(expiraEm)}`;
}

function tokenValido(token) {
  if (typeof token !== "string" || !token.includes(".")) return false;
  const [expiraEm, assinatura] = token.split(".");
  const esperada = assinar(expiraEm);

  // timingSafeEqual exige buffers do mesmo tamanho; comparar assim
  // evita dar pistas do segredo pelo tempo de resposta.
  const a = Buffer.from(assinatura || "", "utf8");
  const b = Buffer.from(esperada, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  return Number(expiraEm) > Date.now();
}

function lerCookie(req, nome) {
  const bruto = req.headers.cookie || "";
  for (const parte of bruto.split(";")) {
    const [chave, ...resto] = parte.trim().split("=");
    if (chave === nome) return decodeURIComponent(resto.join("="));
  }
  return null;
}

// Usado nas rotas que só o admin pode chamar.
function exigirAdmin(req, res, next) {
  if (tokenValido(lerCookie(req, "mix_admin"))) return next();
  return res.status(401).json({ error: "Faça login como admin primeiro." });
}

app.post("/api/admin/login", (req, res) => {
  const senha = String(req.body?.senha || "");
  const esperada = config.adminPassword;

  const a = Buffer.from(senha, "utf8");
  const b = Buffer.from(esperada, "utf8");
  const confere = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!confere) {
    return res.status(401).json({ error: "Senha incorreta." });
  }

  res.setHeader(
    "Set-Cookie",
    `mix_admin=${criarTokenAdmin()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${config.sessionHoras * 3600}${
      process.env.NODE_ENV === "production" ? "; Secure" : ""
    }`
  );
  res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => {
  res.setHeader("Set-Cookie", "mix_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  res.json({ ok: true });
});

// A tela de admin chama isso ao abrir, pra saber se já mostra a lista
// ou se pede a senha.
app.get("/api/admin/status", (req, res) => {
  res.json({
    logado: tokenValido(lerCookie(req, "mix_admin")),
    salvandoNoGitHub: store.usandoGitHub(),
  });
});

// ---------------- RANKING DO K4-SYSTEM (por pontos) ----------------

// Lista pública: é o que alimenta a aba Ranking. Vem direto da tabela
// do plugin K4-System (rank_mix_k4ranks/rank_mix_k4stats), então reflete
// os pontos que o próprio plugin calcula no servidor - não depende mais
// de nada que a equipe cadastre manualmente aqui no site.
// Estatísticas do K4-System (tabela rank_mix_k4stats). Como os nomes das colunas
// podem variar entre versões do plugin, tentamos alguns nomes comuns pra cada
// estatística. O que não existir fica null e o site simplesmente não mostra.
const COLUNAS_STATS = {
  v: ["game_win", "wins", "win", "victories"],
  d: ["game_lose", "losses", "loses", "lose", "defeats"],
  k: ["kills"],
  m: ["deaths"],
  a: ["assists"],
  hs: ["headshots", "headshot", "hs", "headshot_kills"],
};

function pegarStat(linha, candidatos) {
  for (const nome of candidatos) {
    if (linha[nome] !== undefined && linha[nome] !== null && !isNaN(Number(linha[nome]))) {
      return Number(linha[nome]);
    }
  }
  return null;
}

// Vitórias e derrotas REAIS por jogador, contadas nas partidas do MatchZy (as
// mesmas do Histórico de Partidas, respeitando o "Zerar histórico"). O contador
// game_win/game_lose do K4-System às vezes deixa de contar derrotas, mesmo com os
// pontos já descontados. Devolve null se der erro, e aí vale o contador do K4.
async function buscarVitoriasMatchzy() {
  try {
    const desde = await corteSql();
    const [rows] = await pool.query(
      `SELECT CAST(p.steamid64 AS CHAR) AS steam,
              SUM((p.team = m.team1_name AND mp.team1_score > mp.team2_score)
               OR (p.team = m.team2_name AND mp.team2_score > mp.team1_score)) AS v,
              SUM((p.team = m.team1_name AND mp.team1_score < mp.team2_score)
               OR (p.team = m.team2_name AND mp.team2_score < mp.team1_score)) AS d
         FROM matchzy_stats_players p
         JOIN matchzy_stats_matches m ON m.matchid = p.matchid
         JOIN matchzy_stats_maps mp ON mp.matchid = p.matchid AND mp.mapnumber = 0
        WHERE p.mapnumber = 0 AND p.team <> 'Spectator'
          ${desde ? "AND COALESCE(mp.end_time, m.end_time, m.start_time) >= ?" : ""}
        GROUP BY p.steamid64`,
      desde ? [desde] : []
    );
    const porSteam = {};
    for (const r of rows) porSteam[r.steam] = { v: Number(r.v), d: Number(r.d) };
    return porSteam;
  } catch (err) {
    console.warn("[leaderboard] Não consegui contar vitórias pelo MatchZy:", err.message);
    return null;
  }
}

async function buscarResumoStats(steamIds) {
  if (!steamIds.length) return {};
  try {
    const [rows] = await pool.query("SELECT * FROM rank_mix_k4stats WHERE steam_id IN (?)", [steamIds]);
    const mz = await buscarVitoriasMatchzy();
    const porSteam = {};
    for (const r of rows) {
      const resumo = {};
      for (const [chave, candidatos] of Object.entries(COLUNAS_STATS)) {
        resumo[chave] = pegarStat(r, candidatos);
      }
      if (mz) {
        const m = mz[String(r.steam_id)];
        resumo.v = m ? m.v : 0;
        resumo.d = m ? m.d : 0;
      }
      porSteam[r.steam_id] = resumo;
    }
    return porSteam;
  } catch (err) {
    console.warn("[leaderboard] Não consegui ler rank_mix_k4stats:", err.message);
    return {};
  }
}

app.get("/api/leaderboard", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT steam_id, name, points
       FROM rank_mix_k4ranks
       ORDER BY points DESC
       LIMIT ?`,
      [config.leaderboardLimit]
    );
    const ids = rows.map((r) => r.steam_id);
    const [avatares, stats] = await Promise.all([buscarAvatares(ids), buscarResumoStats(ids)]);
    const comAvatar = rows.map((r) => ({
      ...r,
      avatar_url: avatares[r.steam_id] || null,
      resumo: stats[r.steam_id] || null,
    }));
    res.json(comAvatar);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar o ranking." });
  }
});

// ---------------- RANKINGS MANUAIS (1 a 5) ----------------

// Lista usada pelo sorteio: níveis definidos manualmente pela equipe em
// /admin.html, pra equilibrar os times. A aba Ranking NÃO usa mais isso.
app.get("/api/rankings", async (req, res) => {
  try {
    const dados = await store.ler();
    const comSteam = dados.jogadores.filter((j) => j.steam_id).map((j) => j.steam_id);
    const avatares = await buscarAvatares(comSteam);
    res.json({
      atualizado_em: dados.atualizado_em,
      jogadores: dados.jogadores.map((j) => ({
        ...j,
        name: j.nome, // alias: o front já usa "name" nos componentes existentes
        avatar_url: avatares[j.steam_id] || null,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao carregar os rankings." });
  }
});

// Salva a lista inteira de uma vez (a tela de admin manda tudo junto).
app.post("/api/admin/rankings", exigirAdmin, async (req, res) => {
  try {
    const jogadores = req.body?.jogadores;
    if (!Array.isArray(jogadores)) {
      return res.status(400).json({ error: "Formato inválido." });
    }
    if (jogadores.length > 200) {
      return res.status(400).json({ error: "Limite de 200 jogadores." });
    }
    const salvos = await store.salvar(jogadores);
    res.json(salvos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Erro ao salvar os rankings." });
  }
});

// Zera as setas de subiu/desceu do ranking (todo mundo volta pro "-").
app.post("/api/admin/rankings/zerar-setas", exigirAdmin, async (req, res) => {
  try {
    res.json(await store.zerarSetas());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Erro ao zerar as setas." });
  }
});

// Procura um perfil da Steam pelo link ou pelo ID, pra você conseguir
// adicionar no ranking alguém que ainda nem jogou no servidor (e que
// por isso não existe na base do K4).
app.get("/api/admin/steam", exigirAdmin, async (req, res) => {
  try {
    const entrada = String(req.query.q || "").trim();
    if (!entrada) return res.status(400).json({ error: "Informe o link ou o ID da Steam." });

    // Aceita: 7656119... | steamcommunity.com/profiles/7656119... |
    // steamcommunity.com/id/apelido | só o apelido da URL customizada.
    let steamId = null;
    const soNumeros = entrada.match(/^\d{17}$/);
    const porPerfil = entrada.match(/profiles\/(\d{17})/);
    const porApelido = entrada.match(/\/id\/([^/?#]+)/);

    if (soNumeros) steamId = entrada;
    else if (porPerfil) steamId = porPerfil[1];
    else {
      const apelido = porApelido ? porApelido[1] : entrada;
      const url = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v0001/?key=${config.steamApiKey}&vanityurl=${encodeURIComponent(apelido)}`;
      const resp = await fetch(url);
      const data = await resp.json();
      if (data?.response?.success === 1) steamId = data.response.steamid;
    }

    if (!steamId) return res.status(404).json({ error: "Não achei esse perfil na Steam." });

    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${config.steamApiKey}&steamids=${steamId}`;
    const resp = await fetch(url);
    const data = await resp.json();
    const p = data?.response?.players?.[0];
    if (!p) return res.status(404).json({ error: "Perfil não encontrado." });

    res.json({
      steam_id: p.steamid,
      nome: p.personaname,
      avatar_url: p.avatarfull || p.avatarmedium || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao consultar a Steam." });
  }
});

// Busca por nome na base antiga do servidor (tabela do K4, que parou de
// ser atualizada). Hoje so o painel de admin usa isso, pra achar o
// steam_id de quem ja jogou antes; o ranking e o sorteio NAO dependem
// mais dessa tabela.
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

    // O navegador manda só os ids de quem foi marcado. O nível de cada
    // um vem do arquivo de rankings aqui no servidor, nunca do cliente
    // — senão daria pra alguém editar o rank no próprio navegador e
    // bagunçar o equilíbrio do sorteio.
    const ids = req.body.ids;

    // Nomes provisórios: o lápis do sorteio deixa trocar o nome de uma
    // vaga ("Complete 1") só para este sorteio. Chega como { id: nome }.
    // Só vale para vagas personalizadas — jogador com Steam nunca tem o
    // nome trocado por aqui — e nada disso é salvo no ranking.
    const nomesTemp =
      req.body.nomes && typeof req.body.nomes === "object" && !Array.isArray(req.body.nomes)
        ? req.body.nomes
        : {};

    if (!Array.isArray(ids) || ids.length < 2) {
      return res.status(400).json({ error: "Selecione pelo menos 2 jogadores para sortear." });
    }

    const dados = await store.ler();
    const porId = new Map(dados.jogadores.map((j) => [j.id, j]));
    const avatares = await buscarAvatares(dados.jogadores.filter((j) => j.steam_id).map((j) => j.steam_id));
    const jogadores = ids
      .map((id) => porId.get(id))
      .filter(Boolean)
      .map((j) => {
        const temp = j.tipo === "vaga" ? String(nomesTemp[j.id] ?? "").trim().slice(0, 40) : "";
        return { ...j, name: temp || j.nome, avatar_url: avatares[j.steam_id] || null };
      });

    if (jogadores.length < 2) {
      return res.status(400).json({
        error: "Os jogadores selecionados não estão mais no ranking. Recarregue a página.",
      });
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
      const resumir = (time) =>
        time.map((j) => ({ id: j.id, steam_id: j.steam_id, name: j.name, tier: j.tier }));
      const timeANomes = resumir(resultado.timeA);
      const timeBNomes = resumir(resultado.timeB);
      historicoSorteios.push({
        criado_em: new Date(),
        timeA: timeANomes,
        timeB: timeBNomes,
        somaA: resultado.somaA,
        somaB: resultado.somaB,
      });
      limparHistoricoAntigo();
    }, 3000);

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    sorteioEmAndamento = false;
    res.status(500).json({ error: "Erro ao sortear os times." });
  }
});

// Embaralha um array (Fisher-Yates) sem alterar o original. Usado no
// sorteio de vagas, onde cada jogador precisa ter exatamente a mesma
// chance de ficar com uma das vagas.
function embaralhar(array) {
  const copia = [...array];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

// Impede que dois sorteios de vaga rodem ao mesmo tempo.
let vagaSorteioEmAndamento = false;

// Sorteia quem, dentre os jogadores marcados, fica com as vagas
// disponíveis. Ex: 4 jogadores marcados e 2 vagas -> sorteia 2 deles.
// Usa a mesma lista de jogadores do sorteio de times (mesmo endpoint de
// leitura dos rankings), então os nomes provisórios (lápis) valem aqui
// também.
app.post("/api/draft-vaga", async (req, res) => {
  try {
    if (vagaSorteioEmAndamento) {
      return res.status(409).json({ error: "Já tem um sorteio de vaga em andamento. Aguarde terminar." });
    }

    const ids = req.body.ids;
    const vagas = Number(req.body.vagas);

    const nomesTemp =
      req.body.nomes && typeof req.body.nomes === "object" && !Array.isArray(req.body.nomes)
        ? req.body.nomes
        : {};

    if (!Array.isArray(ids) || ids.length < 2) {
      return res.status(400).json({ error: "Selecione pelo menos 2 jogadores para sortear vaga." });
    }
    if (!Number.isInteger(vagas) || vagas < 1) {
      return res.status(400).json({ error: "Informe quantas vagas serão sorteadas." });
    }

    const dados = await store.ler();
    const porId = new Map(dados.jogadores.map((j) => [j.id, j]));
    const avatares = await buscarAvatares(dados.jogadores.filter((j) => j.steam_id).map((j) => j.steam_id));
    const jogadores = ids
      .map((id) => porId.get(id))
      .filter(Boolean)
      .map((j) => {
        const temp = j.tipo === "vaga" ? String(nomesTemp[j.id] ?? "").trim().slice(0, 40) : "";
        return { ...j, name: temp || j.nome, avatar_url: avatares[j.steam_id] || null };
      });

    if (jogadores.length < 2) {
      return res.status(400).json({
        error: "Os jogadores selecionados não estão mais no ranking. Recarregue a página.",
      });
    }
    if (vagas >= jogadores.length) {
      return res.status(400).json({
        error: "O número de vagas precisa ser menor que o número de jogadores selecionados.",
      });
    }

    vagaSorteioEmAndamento = true;

    // Calculado uma única vez no servidor, pra todo mundo ver o mesmo resultado.
    const embaralhados = embaralhar(jogadores);
    const sorteados = embaralhados.slice(0, vagas);
    const idsSorteados = new Set(sorteados.map((j) => j.id));
    const restantes = jogadores.filter((j) => !idsSorteados.has(j.id));

    // Avisa todo mundo conectado que o sorteio começou, pra tela deles
    // mostrar a animação em vez de aparecer o resultado do nada.
    io.emit("vaga:iniciado", { jogadores });

    // Segura um pouco antes de revelar, só pra dar tempo da animação
    // de "sorteando..." rodar na tela de todo mundo.
    setTimeout(() => {
      io.emit("vaga:resultado", { sorteados, restantes, vagas });
      vagaSorteioEmAndamento = false;
    }, 3000);

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    vagaSorteioEmAndamento = false;
    res.status(500).json({ error: "Erro ao sortear a vaga." });
  }
});

// Sorteia um mapa aleatório dentre a lista marcada.
function sortearMapa(mapas) {
  const indice = Math.floor(Math.random() * mapas.length);
  return mapas[indice];
}

// Mapas que já saíram. Fica na memória do servidor, então todo mundo que
// está no site vê os mesmos mapas em cinza. (Zera se o servidor reiniciar.)
const mapasSorteados = new Set();

// Nomes de exibição dos mapas (mesmos ids do front-end, public/app.js).
const NOMES_DE_MAPAS = {
  mirage: "Mirage",
  inferno: "Inferno",
  dust2: "Dust 2",
  nuke: "Nuke",
  overpass: "Overpass",
  vertigo: "Vertigo",
  ancient: "Ancient",
  anubis: "Anubis",
  train: "Train",
  cache: "Cache",
  cobblestone: "Cobblestone",
};

// O ultimo mapa sorteado no site ({ id, nome, em }). O MatchZy nao manda o
// mapa de um jeito que a gente leia, entao o historico usa este como
// alternativa. Fica na memoria, como o sorteio de times (zera se o
// servidor reiniciar).
let ultimoMapaSorteado = null;

// "de_dust2" / "de_cbble" / "cs_office" -> "Dust 2" / "Cobblestone" / "Office".
function nomeBonitoDoMapa(bruto) {
  const limpo = String(bruto ?? "")
    .trim()
    .toLowerCase()
    .replace(/^(de|cs|ar)_/, "");
  if (!limpo) return null;
  if (limpo === "cbble") return NOMES_DE_MAPAS.cobblestone;
  if (NOMES_DE_MAPAS[limpo]) return NOMES_DE_MAPAS[limpo];
  return limpo.charAt(0).toUpperCase() + limpo.slice(1);
}

// Procura o nome do mapa em qualquer lugar do evento do MatchZy (campo
// "map", "map_name", "mapname", "current_map"...), sem depender de onde ele vem.
function acharMapaNoEvento(obj, profundidade = 0) {
  if (!obj || typeof obj !== "object" || profundidade > 4) return null;
  for (const [chave, valor] of Object.entries(obj)) {
    if (/^(current_?)?map(_?name)?$/i.test(chave) && typeof valor === "string" && valor.trim()) {
      return valor.trim();
    }
  }
  for (const valor of Object.values(obj)) {
    if (valor && typeof valor === "object") {
      const achado = acharMapaNoEvento(valor, profundidade + 1);
      if (achado) return achado;
    }
  }
  return null;
}

io.on("connection", (socket) => {
  socket.emit("mapa:sorteados", Array.from(mapasSorteados));
});

// Impede que dois sorteios de mapa rodem ao mesmo tempo.
let mapaSorteioEmAndamento = false;

app.post("/api/draft-mapa", async (req, res) => {
  try {
    if (mapaSorteioEmAndamento) {
      return res.status(409).json({ error: "Já tem um sorteio de mapa em andamento. Aguarde terminar." });
    }

    const pedidos = req.body.mapas;

    if (!Array.isArray(pedidos) || pedidos.length < 1) {
      return res.status(400).json({ error: "Selecione pelo menos 1 mapa para sortear." });
    }

    // Mapas que já foram sorteados ficam de fora até serem devolvidos.
    const mapas = pedidos.filter((id) => !mapasSorteados.has(id));
    if (mapas.length < 1) {
      return res.status(400).json({
        error: "Todos os mapas selecionados já foram sorteados. Devolva algum mapa à rodada para sortear de novo.",
      });
    }

    mapaSorteioEmAndamento = true;

    // Calculado uma única vez no servidor, pra todo mundo ver o mesmo mapa.
    const mapaId = sortearMapa(mapas);

    io.emit("mapa:iniciado", { mapas, mapaId, duracao: 4000 });

    setTimeout(() => {
      mapasSorteados.add(mapaId);
      ultimoMapaSorteado = { id: mapaId, nome: NOMES_DE_MAPAS[mapaId] || mapaId, em: new Date() };
      io.emit("mapa:resultado", { mapaId });
      io.emit("mapa:sorteados", Array.from(mapasSorteados));
      mapaSorteioEmAndamento = false;
    }, 4200);

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    mapaSorteioEmAndamento = false;
    res.status(500).json({ error: "Erro ao sortear o mapa." });
  }
});

// Devolve um mapa já sorteado para a rodada de sorteio.
app.post("/api/mapa/devolver", (req, res) => {
  const { mapaId } = req.body;
  if (typeof mapaId !== "string") {
    return res.status(400).json({ error: "Mapa inválido." });
  }
  mapasSorteados.delete(mapaId);
  io.emit("mapa:sorteados", Array.from(mapasSorteados));
  res.json({ ok: true });
});

// Retorna os sorteios de hoje, mais recente primeiro.
app.get("/api/draft-history", (req, res) => {
  limparHistoricoAntigo();
  const ordenado = [...historicoSorteios].sort((a, b) => b.criado_em - a.criado_em);
  res.json(ordenado);
});

// Guarda o resultado da última partida (quem ganhou, o placar de rounds),
// recebido via webhook do próprio MatchZy quando a partida termina.
let ultimoResultadoPartida = null;

// O MatchZy manda o placar de rounds (tipo 16 x 10) num evento separado
// ("map_result"), que chega um pouco ANTES do "series_end" (que traz só
// quem ganhou, sem o placar de rounds). Guarda aqui temporariamente pra
// juntar os dois quando o "series_end" chegar.
let ultimoPlacarDeRounds = null;

// Tenta achar o placar de rounds dentro do objeto de um time, testando
// alguns nomes de campo possíveis (o MatchZy não documenta isso 100%
// explicitamente, então cobrimos as variações mais prováveis).
function extrairPlacarDeRounds(timeObj) {
  if (!timeObj || typeof timeObj !== "object") return null;
  const camposPossiveis = ["score", "round_score", "roundScore", "team_score"];
  for (const campo of camposPossiveis) {
    if (typeof timeObj[campo] === "number") return timeObj[campo];
  }
  return null;
}

// Tenta ler a lista de jogadores de um time no evento do MatchZy. O
// formato exato nao e garantido, entao e tolerante: se nao achar, devolve
// null e o historico usa so a lista do sorteio.
function extrairJogadoresMatchZy(timeObj) {
  const lista = timeObj?.players;
  if (!Array.isArray(lista)) return null;
  const jogadores = lista
    .map((p) => ({
      steam_id: String(p?.steamid ?? p?.steam_id ?? p?.steamId ?? "") || null,
      name: p?.name ?? p?.nickname ?? null,
    }))
    .filter((p) => p.steam_id || p.name);
  return jogadores.length ? jogadores : null;
}

// A lista de jogadores pode vir em lugares diferentes do evento
// (team1.players, stats_team1.players ou team1.stats.players).
function lerJogadoresDoEvento(evento, n) {
  const time = evento?.[`team${n}`];
  const stats = evento?.[`stats_team${n}`];
  return (
    extrairJogadoresMatchZy(time) ||
    extrairJogadoresMatchZy(stats) ||
    extrairJogadoresMatchZy(time?.stats) ||
    null
  );
}

function contarJogadoresEmComum(jogadoresMZ, timeSite) {
  if (!Array.isArray(jogadoresMZ) || !Array.isArray(timeSite)) return 0;
  const ids = new Set(timeSite.map((j) => String(j.steam_id ?? "").trim()).filter(Boolean));
  const nomes = new Set(timeSite.map((j) => String(j.name ?? "").trim().toLowerCase()).filter(Boolean));
  return jogadoresMZ.filter((p) =>
    p.steam_id ? ids.has(String(p.steam_id).trim()) : p.name && nomes.has(String(p.name).trim().toLowerCase())
  ).length;
}

// Normaliza um nome pra comparar "team_JV_putifero" com "JV putifero":
// minusculo, sem acento e qualquer sequencia de simbolos/espacos vira "_".
function normalizarNome(nome) {
  return String(nome ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// O MatchZy chama os times de "team_<nome do capitao>". Tira o prefixo
// "team_" e normaliza, pra comparar com os nomes dos jogadores do sorteio.
function nomeDoCapitaoDoTime(nomeTime) {
  const n = normalizarNome(nomeTime);
  return n.startsWith("team_") ? n.slice(5) : n;
}

// Em qual time do sorteio (A ou B) esta o capitao que da nome ao time do
// MatchZy? Devolve "A", "B" ou null (nao achou, ou achou nos dois).
function timeSitePeloNome(nomeTimeMatchZy, timeA, timeB) {
  const capitao = nomeDoCapitaoDoTime(nomeTimeMatchZy);
  if (!capitao) return null;
  const esta = (lista) =>
    Array.isArray(lista) && lista.some((j) => normalizarNome(j?.name) === capitao);
  const emA = esta(timeA);
  const emB = esta(timeB);
  if (emA && !emB) return "A";
  if (emB && !emA) return "B";
  return null;
}

// O MatchZy numera os times (team1/team2) do jeito dele, e isso NAO e
// garantido de bater com o Time A/B do sorteio: as pessoas escolhem o lado
// ao entrar no servidor, entao team1 pode ser o Time A ou o Time B. Por isso
// descobre quem e quem, nesta ordem:
//   1. metodo "nome"     = pelo nome do time (team_<capitao>) - acompanha o
//                          grupo a partida toda, mesmo com faca e troca de lado;
//   2. metodo "jogadores" = pela lista de jogadores do evento, se vier;
//   3. metodo "padrao"    = nao deu pra saber, assume team1 = Time A (pode
//                          estar invertido - o painel avisa pra conferir).
function decidirMapeamento({ jogadoresTeam1, jogadoresTeam2, timeA, timeB, nomeTeam1, nomeTeam2 }) {
  // 1) Pelo nome do time
  const t1 = timeSitePeloNome(nomeTeam1, timeA, timeB);
  const t2 = timeSitePeloNome(nomeTeam2, timeA, timeB);
  if (t1 && t2 && t1 !== t2) return { invertido: t1 === "B", metodo: "nome" };
  if (t1 && !t2) return { invertido: t1 === "B", metodo: "nome" };
  if (t2 && !t1) return { invertido: t2 === "A", metodo: "nome" };

  // 2) Pelos jogadores
  const normal =
    contarJogadoresEmComum(jogadoresTeam1, timeA) + contarJogadoresEmComum(jogadoresTeam2, timeB);
  const invertido =
    contarJogadoresEmComum(jogadoresTeam1, timeB) + contarJogadoresEmComum(jogadoresTeam2, timeA);
  if (normal !== invertido) return { invertido: invertido > normal, metodo: "jogadores" };

  // 3) Sem informacao
  return { invertido: false, metodo: "padrao" };
}

// Chamado pelo MatchZy (configurado via matchzy_remote_log_url) toda vez
// que qualquer evento de partida acontece. A gente usa dois eventos:
// "map_result" (placar de rounds do mapa) e "series_end" (quem ganhou a
// partida) — os outros são só confirmados com 200 OK e ignorados, pra não
// fazer o MatchZy ficar tentando de novo.
app.post("/api/matchzy/evento", (req, res) => {
  const segredoRecebido = req.header("x-plugin-secret");
  if (!segredoRecebido || segredoRecebido !== config.pluginSecret) {
    return res.status(401).json({ error: "Não autorizado." });
  }

  const evento = req.body;

  // Diagnostico: loga o payload bruto dos 2 eventos que usamos, pra descobrir
  // os nomes reais dos campos (lista de jogadores, mapa). Nao tem segredo aqui.
  if (evento?.event === "map_result" || evento?.event === "series_end") {
    console.log(`[MatchZy] payload ${evento.event}:`, JSON.stringify(evento).slice(0, 6000));
  }

  if (evento.event === "map_result") {
    const placarTeam1 = extrairPlacarDeRounds(evento.team1);
    const placarTeam2 = extrairPlacarDeRounds(evento.team2);

    if (placarTeam1 !== null && placarTeam2 !== null) {
      const jogadoresTeam1 = lerJogadoresDoEvento(evento, 1);
      const jogadoresTeam2 = lerJogadoresDoEvento(evento, 2);
      // OBS: "team1/team2" aqui sao os numeros do MatchZy, nao o Time A/B.
      ultimoPlacarDeRounds = {
        placarTeam1,
        placarTeam2,
        jogadoresTeam1,
        jogadoresTeam2,
        team1Nome: evento.team1?.name ?? null,
        team2Nome: evento.team2?.name ?? null,
        mapa: acharMapaNoEvento(evento),
      };
      if (!jogadoresTeam1 || !jogadoresTeam2) {
        console.warn(
          "[MatchZy] map_result sem lista de jogadores - nao da pra identificar os times por ela. Chaves do evento:",
          Object.keys(evento),
          "| chaves de team1:",
          Object.keys(evento.team1 || {})
        );
      }
    } else {
      // Não achamos o campo esperado — loga o evento inteiro pra ajustar
      // o nome do campo certo depois, sem quebrar nada nesse meio tempo.
      console.warn("[MatchZy] Não achei o placar de rounds no evento map_result:", JSON.stringify(evento));
    }
    return res.json({ ok: true });
  }

  if (evento.event !== "series_end") {
    return res.json({ ok: true });
  }

  // Qual sorteio corresponde a essa partida (o mais recente do dia).
  const sorteioDaPartida = historicoSorteios.length
    ? historicoSorteios[historicoSorteios.length - 1]
    : null;

  // Jogadores que o MatchZy diz ter em cada time (do map_result guardado ou,
  // se nao tiver, do proprio series_end).
  const jogadoresTeam1 = ultimoPlacarDeRounds?.jogadoresTeam1 ?? lerJogadoresDoEvento(evento, 1);
  const jogadoresTeam2 = ultimoPlacarDeRounds?.jogadoresTeam2 ?? lerJogadoresDoEvento(evento, 2);

  // O team1/team2 do MatchZy NAO e necessariamente Time A/Time B (a faca e a
  // troca de lado podem inverter). Descobre pelos jogadores; se nao der,
  // cai no padrao antigo (team1 = Time A) e marca "padrao" no registro.
  const nomeTeam1 = ultimoPlacarDeRounds?.team1Nome ?? evento.team1?.name ?? null;
  const nomeTeam2 = ultimoPlacarDeRounds?.team2Nome ?? evento.team2?.name ?? null;
  const { invertido, metodo } = decidirMapeamento({
    jogadoresTeam1,
    jogadoresTeam2,
    timeA: sorteioDaPartida?.timeA,
    timeB: sorteioDaPartida?.timeB,
    nomeTeam1,
    nomeTeam2,
  });
  const timeDoTeam1 = invertido ? "B" : "A";
  const timeDoTeam2 = invertido ? "A" : "B";

  let vencedor = null;
  if (evento.winner?.team === "team1") vencedor = timeDoTeam1;
  else if (evento.winner?.team === "team2") vencedor = timeDoTeam2;

  // Placar de rounds real (do map_result); se nao chegou, cai pro placar de
  // mapas da serie (em BO1 e sempre 1x0, mas e melhor que nada).
  const placarTeam1 = ultimoPlacarDeRounds?.placarTeam1 ?? evento.team1_series_score ?? null;
  const placarTeam2 = ultimoPlacarDeRounds?.placarTeam2 ?? evento.team2_series_score ?? null;

  console.log(
    `[MatchZy] series_end: vencedor=${vencedor ?? "nenhum"} | identificação=${metodo}${invertido ? " (team1 = Time B)" : ""}`
  );
  if (metodo === "padrao") {
    console.warn(
      "[MatchZy] Não consegui identificar os times pelos jogadores; assumi team1 = Time A. Chaves do series_end:",
      Object.keys(evento)
    );
  }

  ultimoResultadoPartida = {
    criado_em: new Date(),
    vencedor, // "A" | "B" | null (null = empate ou sem vencedor)
    placarA: invertido ? placarTeam2 : placarTeam1,
    placarB: invertido ? placarTeam1 : placarTeam2,
  };

  const jogadoresMatchZy = {
    A: invertido ? jogadoresTeam2 : jogadoresTeam1,
    B: invertido ? jogadoresTeam1 : jogadoresTeam2,
  };
  const team1Nome = nomeTeam1;
  const team2Nome = nomeTeam2;
  // Mapa: primeiro o que o MatchZy mandou (map_result ou series_end); se nao
  // veio, o ultimo mapa sorteado no site nas ultimas 4h (origem "sorteio").
  let mapaDaPartida = null;
  let mapaOrigem = null;
  const mapaBruto = ultimoPlacarDeRounds?.mapa ?? acharMapaNoEvento(evento);
  if (mapaBruto) {
    mapaDaPartida = nomeBonitoDoMapa(mapaBruto);
    mapaOrigem = "matchzy";
  } else if (ultimoMapaSorteado && Date.now() - ultimoMapaSorteado.em.getTime() < 4 * 60 * 60 * 1000) {
    mapaDaPartida = ultimoMapaSorteado.nome;
    mapaOrigem = "sorteio";
  }
  const enxugar = (lista) =>
    Array.isArray(lista) ? lista.map((j) => ({ steam_id: j.steam_id ?? null, name: j.name ?? null })) : null;

  ultimoPlacarDeRounds = null; // limpa pra não vazar pra próxima partida

  // Se ainda tiver o sorteio dessa rodada no histórico do dia, anexa o
  // resultado nele também, pra aparecer junto na lista de sorteios de hoje.
  if (historicoSorteios.length > 0) {
    historicoSorteios[historicoSorteios.length - 1].resultado = ultimoResultadoPartida;
  }

  io.emit("partida:resultado", ultimoResultadoPartida);

  // Guarda também no histórico persistido de auditoria (painel de admin),
  // pra dar pra comparar depois com o que o K4-System contabilizou. Não
  // espera terminar pra responder o webhook - se o GitHub demorar ou
  // falhar, só loga o erro, sem fazer o MatchZy re-tentar à toa.
  const chaveDedup =
    evento.matchid != null ? `${evento.matchid}:${evento.map_number ?? ""}` : null;
  historico
    .registrar(
      {
        criado_em: ultimoResultadoPartida.criado_em.toISOString(),
        vencedor, // "A" | "B" | null
        placarA: ultimoResultadoPartida.placarA,
        placarB: ultimoResultadoPartida.placarB,
        mapa: mapaDaPartida,
        // "matchzy" = veio do evento; "sorteio" = ultimo mapa sorteado no site.
        mapa_origem: mapaOrigem,
        matchid: evento.matchid ?? null,
        jogadoresA: enxugar(sorteioDaPartida?.timeA),
        jogadoresB: enxugar(sorteioDaPartida?.timeB),
        sorteio_em: sorteioDaPartida ? sorteioDaPartida.criado_em.toISOString() : null,
        jogadoresMatchZyA: jogadoresMatchZy.A,
        jogadoresMatchZyB: jogadoresMatchZy.B,
        // Como o vencedor foi atribuido: "jogadores" (confirmado) ou "padrao"
        // (assumiu team1 = Time A, pode estar invertido).
        mapeamento: metodo,
        team1_nome: team1Nome,
        team2_nome: team2Nome,
      },
      { chaveDedup }
    )
    .catch((err) => console.error("[Histórico] Não consegui salvar a partida:", err.message));

  res.json({ ok: true });
});

// ---------------- HISTÓRICO DE PARTIDAS (auditoria, admin) ----------------
// Lista bruta de "quem ganhou cada partida", alimentada pelo webhook do
// MatchZy acima - é uma fonte independente do K4-System, útil pra achar
// partida que sumiu ou que foi contabilizada errado nos pontos.
app.get("/api/admin/historico-partidas", exigirAdmin, async (req, res) => {
  try {
    const dados = await historico.ler({ forcar: true });
    res.json(dados);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao carregar o histórico." });
  }
});

// Apaga tudo, pra começar a próxima conferência do zero. Não mexe em
// pontos nem em rankings - só limpa esse registro de auditoria.
app.post("/api/admin/historico-partidas/limpar", exigirAdmin, async (req, res) => {
  try {
    const dados = await historico.limpar();
    res.json(dados);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao limpar o histórico." });
  }
});

// Corrige uma partida em que o vencedor/placar saiu invertido: troca
// Time A <-> Time B no vencedor e no placar. Chamar de novo desfaz.
app.post("/api/admin/historico-partidas/:id/inverter", exigirAdmin, async (req, res) => {
  try {
    const dados = await historico.inverter(String(req.params.id));
    if (!dados) return res.status(404).json({ error: "Partida não encontrada." });
    res.json(dados);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao corrigir a partida." });
  }
});

// ---------------- SNAPSHOT DO RANKING (auditoria, admin) ----------------
// Guarda uma foto do ranking (pontos + stats do K4-System), SUBSTITUINDO a
// anterior. So e tirada MANUALMENTE, pelo botao "Tirar snapshot agora" do
// admin. Nao existe mais agendamento (nada de 7h, cron ou verificacao
// periodica).

let snapshotEmAndamento = false;

// Le o ranking ao vivo (pontos + stats do K4-System), do 1o ao ultimo.
// Usado pelo snapshot e pelo fechamento de temporada.
async function lerRankingAoVivo() {
  const [rows] = await pool.query(
    `SELECT steam_id, name, points
     FROM rank_mix_k4ranks
     ORDER BY points DESC
     LIMIT 2000`
  );
  const stats = await buscarResumoStats(rows.map((r) => r.steam_id));

  return rows.map((r, i) => {
    const s = stats[r.steam_id] || {};
    return {
      pos: i + 1,
      steam_id: r.steam_id,
      name: r.name,
      points: Number(r.points),
      v: s.v ?? null,
      d: s.d ?? null,
      k: s.k ?? null,
      m: s.m ?? null,
      a: s.a ?? null,
      hs: s.hs ?? null,
    };
  });
}

async function tirarSnapshotDoRanking(motivo) {
  const jogadores = await lerRankingAoVivo();
  return snapshot.salvar({
    tirado_em: new Date().toISOString(),
    motivo,
    jogadores,
  });
}

// Tira um snapshot agora (substitui o atual). Impede dois ao mesmo tempo.
async function tirarSnapshotAgora(motivo) {
  if (snapshotEmAndamento) return { pulado: "em_andamento" };
  snapshotEmAndamento = true;
  try {
    const novo = await tirarSnapshotDoRanking(motivo);
    return { criado: true, snapshot: novo };
  } finally {
    snapshotEmAndamento = false;
  }
}

app.get("/api/admin/snapshot-ranking", exigirAdmin, async (req, res) => {
  try {
    res.json(await snapshot.ler({ forcar: true }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao carregar o snapshot." });
  }
});

// Botao "Tirar snapshot agora" do admin (substitui o atual).
app.post("/api/admin/snapshot-ranking/agora", exigirAdmin, async (req, res) => {
  try {
    const r = await tirarSnapshotAgora("manual");
    if (r.pulado === "em_andamento") {
      return res.status(409).json({ error: "Já tem um snapshot sendo tirado. Tente de novo em instantes." });
    }
    res.json(r.snapshot);
  } catch (err) {
    console.error("[Snapshot] Falha manual:", err.message);
    res.status(500).json({ error: "Erro ao tirar o snapshot." });
  }
});

// ---------------- TEMPORADAS (ranking mensal) ----------------
// Todo mes o ranking e fechado e guardado como uma temporada (ver
// temporadas.js). A aba "Temporadas" do site le daqui; o fechamento pode
// ser feito pelo admin (a partir de um snapshot ou do ranking ao vivo) ou
// automaticamente no ultimo dia do mes. O RESET dos pontos continua sendo
// feito por voce no K4-System - o site nunca zera pontos sozinho.

// Data/hora em Brasilia, independente do fuso do servidor (o Render roda em UTC).
function partesBrasilia(data = new Date()) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(data).map((x) => [x.type, x.value]));
  const ano = Number(p.year);
  const mes = Number(p.month);
  return {
    ano, mes,
    dia: Number(p.day),
    hora: Number(p.hour),
    minuto: Number(p.minute),
    ultimoDia: new Date(Date.UTC(ano, mes, 0)).getUTCDate(),
    id: `${p.year}-${p.month}`,
  };
}

function resumoTemporada(t, avatares = {}) {
  const lider = t.jogadores[0] || null;
  return {
    id: t.id,
    nome: t.nome,
    fechado_em: t.fechado_em,
    origem: t.origem,
    total: t.jogadores.length,
    campeao: lider
      ? { steam_id: lider.steam_id, name: lider.name, points: lider.points, avatar_url: avatares[lider.steam_id] || null }
      : null,
  };
}

// Histórico de partidas (tabelas do MatchZy: matchzy_stats_*). Espectadores
// (team = 'Spectator') ficam de fora. O vencedor sai do placar, não do campo
// "winner" (a tabela de mapas corta nomes longos). steamid64 é lido como texto
// (CAST) porque BIGINT perde precisão como número no JavaScript.

// Data de corte do histórico (admin: "Zerar histórico de partidas"), no formato
// do MySQL (UTC). Sem corte, devolve null e tudo aparece.
async function corteSql() {
  try {
    const c = await corte.ler();
    return c.desde ? new Date(c.desde).toISOString().slice(0, 19).replace("T", " ") : null;
  } catch (err) {
    console.error("[Corte]", err.message);
    return null;
  }
}

// Todos os jogadores com partida depois do corte (a tela filtra na hora, sem
// ir ao servidor a cada letra). "nomes" inclui apelidos antigos.
app.get("/api/partidas/jogadores", async (req, res) => {
  try {
    const desde = await corteSql();
    const [rows] = await pool.query(
      `SELECT CAST(steamid64 AS CHAR) AS steam,
              SUBSTRING_INDEX(GROUP_CONCAT(name ORDER BY matchid DESC SEPARATOR '\n'), '\n', 1) AS nome,
              GROUP_CONCAT(DISTINCT name SEPARATOR '\n') AS nomes,
              COUNT(*) AS partidas
         FROM matchzy_stats_players
        WHERE mapnumber = 0 AND team <> 'Spectator'
          ${desde ? "AND matchid IN (SELECT matchid FROM matchzy_stats_maps WHERE mapnumber = 0 AND COALESCE(end_time, start_time) >= ?)" : ""}
        GROUP BY steamid64 ORDER BY partidas DESC LIMIT 500`,
      desde ? [desde] : []
    );
    const av = await buscarAvatares(rows.map((r) => r.steam));
    res.json(rows.map((r) => ({
      steam_id: r.steam, nome: r.nome, partidas: r.partidas, avatar_url: av[r.steam] || null,
      nomes: String(r.nomes || "").split("\n").slice(0, 8),
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao listar jogadores." });
  }
});

// Admin: corte do histórico. POST = "a partir de agora"; DELETE = mostra tudo.
app.get("/api/admin/partidas-corte", exigirAdmin, async (req, res) => {
  try { res.json(await corte.ler({ forcar: true })); }
  catch (err) { console.error(err); res.status(500).json({ error: "Erro ao ler o corte." }); }
});
app.post("/api/admin/partidas-corte", exigirAdmin, async (req, res) => {
  try { res.json(await corte.definir(new Date().toISOString())); }
  catch (err) { console.error(err); res.status(500).json({ error: "Erro ao salvar o corte." }); }
});
app.delete("/api/admin/partidas-corte", exigirAdmin, async (req, res) => {
  try { res.json(await corte.definir(null)); }
  catch (err) { console.error(err); res.status(500).json({ error: "Erro ao remover o corte." }); }
});

// Baixar a demo de uma partida: pede ao painel um link temporário e redireciona.
// Limite simples (30 por minuto no site todo) pra ninguém martelar a API do painel.
let demoJanela = 0, demoCont = 0;
app.get("/api/partidas/:id/demo", async (req, res) => {
  const agora = Date.now();
  if (agora - demoJanela > 60000) { demoJanela = agora; demoCont = 0; }
  if (++demoCont > 30) return res.status(429).type("text").send("Muitos downloads agora. Tente de novo em instantes.");
  if (!/^\d+$/.test(req.params.id)) return res.status(400).type("text").send("Partida inválida.");
  try {
    const url = await demos.linkDownload(req.params.id);
    if (!url) return res.status(404).type("text").send("Demo não encontrada para essa partida.");
    res.redirect(url);
  } catch (err) {
    console.error("[demos]", err.message);
    res.status(502).type("text").send("Não consegui falar com o servidor das demos agora. Tente de novo mais tarde.");
  }
});

// Lista as últimas partidas. Com ?steam=ID, só as partidas desse jogador (até
// 100) e um resumo dele.
app.get("/api/partidas", async (req, res) => {
  try {
    const steam = /^\d{17}$/.test(String(req.query.steam || "")) ? String(req.query.steam) : null;
    const limite = Math.min(Math.max(parseInt(req.query.limit, 10) || (steam ? 100 : 30), 1), 100);
    const desde = await corteSql();
    const conds = [], pars = [];
    if (desde) { conds.push("COALESCE(mp.end_time, m.end_time, m.start_time) >= ?"); pars.push(desde); }
    if (steam) {
      conds.push(`m.matchid IN (SELECT matchid FROM matchzy_stats_players
                                 WHERE mapnumber = 0 AND team <> 'Spectator' AND steamid64 = CAST(? AS UNSIGNED))`);
      pars.push(steam);
    }
    const filtro = conds.length ? "WHERE " + conds.join(" AND ") : "";
    const [partidas] = await pool.query(
      `SELECT m.matchid, mp.mapname,
              DATE_FORMAT(COALESCE(mp.end_time, m.end_time, m.start_time), '%Y-%m-%dT%H:%i:%sZ') AS fim,
              m.team1_name, m.team2_name, mp.team1_score, mp.team2_score,
              TIMESTAMPDIFF(MINUTE, mp.start_time, mp.end_time) AS dur
         FROM matchzy_stats_matches m
         JOIN matchzy_stats_maps mp ON mp.matchid = m.matchid AND mp.mapnumber = 0
         ${filtro}
        ORDER BY m.matchid DESC LIMIT ?`,
      [...pars, limite]
    );
    if (!partidas.length) return res.json({ partidas: [], jogador: null });

    const [jogs] = await pool.query(
      `SELECT matchid, CAST(steamid64 AS CHAR) AS steam, team, name, kills, deaths, assists, damage, head_shot_kills
         FROM matchzy_stats_players
        WHERE mapnumber = 0 AND team <> 'Spectator' AND matchid IN (?)`,
      [partidas.map((p) => p.matchid)]
    );
    const av = await buscarAvatares([...new Set(jogs.map((j) => j.steam))]);
    // Quais partidas têm demo na pasta do servidor (falha = sem botão, sem quebrar a lista).
    const demoMap = await demos.mapa().catch((err) => { console.warn("[demos]", err.message); return {}; });

    const porPartida = {};
    for (const j of jogs) {
      (porPartida[j.matchid] ||= []).push({
        steam_id: j.steam, nome: j.name, team: j.team, avatar_url: av[j.steam] || null,
        k: j.kills, d: j.deaths, a: j.assists, dano: j.damage, hs: j.head_shot_kills,
      });
    }

    let jogador = null;
    const saida = partidas.map((p) => {
      const vencedor = p.team1_score > p.team2_score ? 1 : p.team2_score > p.team1_score ? 2 : null;
      const jogadores = (porPartida[p.matchid] || [])
        .map((j) => ({ ...j, time: j.team === p.team1_name ? 1 : 2, team: undefined }))
        .sort((a, b) => a.time - b.time || b.k - a.k);
      if (steam) {
        const eu = jogadores.find((j) => j.steam_id === steam);
        if (eu) {
          jogador ||= { steam_id: steam, nome: eu.nome, avatar_url: eu.avatar_url,
                        resumo: { partidas: 0, v: 0, d: 0, k: 0, m: 0, a: 0, dano: 0, rounds: 0, hs: 0 } };
          const r = jogador.resumo;
          r.partidas++; r.k += eu.k; r.m += eu.d; r.a += eu.a; r.dano += eu.dano; r.hs += eu.hs;
          r.rounds += p.team1_score + p.team2_score;
          if (vencedor === eu.time) r.v++; else if (vencedor) r.d++;
        }
      }
      return { id: p.matchid, mapa: p.mapname, fim: p.fim, time1: p.team1_name, time2: p.team2_name,
               placar1: p.team1_score, placar2: p.team2_score, vencedor, jogadores,
               demo: demoMap[String(p.matchid)] ? { mb: Math.round(demoMap[String(p.matchid)].tamanho / 1048576) } : null,
               duracao: p.dur != null && p.dur >= 0 ? Number(p.dur) : null };
    });
    res.json({ partidas: saida, jogador });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao carregar as partidas." });
  }
});

// Pontos de um jogador ao fim de cada temporada (alimenta o grafico do perfil).
app.get("/api/jogador/:steam/temporadas", async (req, res) => {
  if (!/^\d{17}$/.test(req.params.steam)) return res.status(400).json({ error: "SteamID inválido." });
  try {
    const lista = await temporadas.listar();
    const saida = lista
      .map((t) => {
        const j = (t.jogadores || []).find((x) => String(x.steam_id) === req.params.steam);
        return j ? { id: t.id, nome: t.nome, points: j.points ?? 0 } : null;
      })
      .filter(Boolean)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    res.json(saida);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao carregar o histórico de pontos." });
  }
});

// Lista publica de temporadas (so o resumo, sem a tabela inteira).
app.get("/api/temporadas", async (req, res) => {
  try {
    const lista = await temporadas.listar();
    const avatares = await buscarAvatares(lista.map((t) => t.jogadores[0]?.steam_id).filter(Boolean));
    res.json(lista.map((t) => resumoTemporada(t, avatares)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao carregar as temporadas." });
  }
});

// Uma temporada completa (ranking daquele mes), com avatares.
app.get("/api/temporadas/:id", async (req, res) => {
  try {
    const t = await temporadas.obter(req.params.id);
    if (!t) return res.status(404).json({ error: "Temporada não encontrada." });
    const avatares = await buscarAvatares(t.jogadores.map((j) => j.steam_id));
    res.json({
      ...resumoTemporada(t, avatares),
      jogadores: t.jogadores.map((j) => ({ ...j, avatar_url: avatares[j.steam_id] || null })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao carregar a temporada." });
  }
});

const ERROS_TEMPORADA = {
  mes_invalido: [400, "Mês inválido. Use o formato AAAA-MM (ex.: 2026-10)."],
  sem_jogadores: [400, "Não há jogadores para guardar nessa temporada."],
  ja_existe: [409, "Já existe uma temporada desse mês. Marque \"substituir\" se quiser trocar."],
  nao_encontrada: [404, "Temporada não encontrada."],
};

// Fecha uma temporada pelo admin. fonte:
//   "snapshot_atual"    -> usa o snapshot mais recente (ex.: o que voce tirou antes do reset)
//   "snapshot_anterior" -> usa o snapshot anterior
//   "ranking"           -> usa o ranking ao vivo agora
app.post("/api/admin/temporadas", exigirAdmin, async (req, res) => {
  try {
    const { mes, fonte, substituir } = req.body || {};
    if (!temporadas.nomeDoMes(mes)) {
      const [status, error] = ERROS_TEMPORADA.mes_invalido;
      return res.status(status).json({ error });
    }

    let jogadores = [];
    let tirado_em = null;
    if (fonte === "snapshot_atual" || fonte === "snapshot_anterior") {
      const snap = await snapshot.ler({ forcar: true });
      const foto = fonte === "snapshot_atual" ? snap : snap.anterior;
      if (!foto || !foto.jogadores?.length) {
        return res.status(400).json({ error: "Esse snapshot não existe ou está vazio." });
      }
      jogadores = foto.jogadores;
      tirado_em = foto.tirado_em;
    } else if (fonte === "ranking") {
      jogadores = await lerRankingAoVivo();
      tirado_em = new Date().toISOString();
      if (!jogadores.length || Number(jogadores[0].points) <= 0) {
        return res.status(400).json({
          error: "O ranking ao vivo está zerado (o reset já foi feito?). Use um snapshot como fonte.",
        });
      }
    } else {
      return res.status(400).json({ error: "Fonte inválida." });
    }

    const r = await temporadas.salvar({ id: mes, jogadores, origem: fonte, tirado_em, substituir: Boolean(substituir) });
    if (!r.ok) {
      const [status, error] = ERROS_TEMPORADA[r.motivo] || [500, "Erro ao salvar a temporada."];
      return res.status(status).json({ error });
    }
    res.json(resumoTemporada(r.temporada));
  } catch (err) {
    console.error("[Temporadas] Falha ao fechar:", err.message);
    res.status(500).json({ error: "Erro ao salvar a temporada." });
  }
});

app.delete("/api/admin/temporadas/:id", exigirAdmin, async (req, res) => {
  try {
    const r = await temporadas.remover(req.params.id);
    if (!r.ok) {
      const [status, error] = ERROS_TEMPORADA[r.motivo] || [500, "Erro ao remover a temporada."];
      return res.status(status).json({ error });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("[Temporadas] Falha ao remover:", err.message);
    res.status(500).json({ error: "Erro ao remover a temporada." });
  }
});

// Fechamento automatico: no ULTIMO DIA do mes, a partir das 23:50 (Brasilia),
// guarda o ranking ao vivo como a temporada daquele mes. Salvaguardas:
//  - nao faz nada se a temporada do mes ja existir (nunca sobrescreve);
//  - nao faz nada se o ranking estiver zerado (reset ja feito).
// Precisa do servidor acordado nessa janela; por isso tambem existe a rota
// /api/cron/fechar-temporada, pra um cron externo acordar o site as 23:55.
let fechamentoEmAndamento = false;

async function fecharMesAutomatico() {
  const agora = partesBrasilia();
  const naJanela = agora.dia === agora.ultimoDia && (agora.hora > 23 || (agora.hora === 23 && agora.minuto >= 50));
  if (!naJanela) return { pulado: "fora_da_janela" };
  if (fechamentoEmAndamento) return { pulado: "em_andamento" };

  fechamentoEmAndamento = true;
  try {
    if (await temporadas.obter(agora.id)) return { pulado: "ja_existe", id: agora.id };

    const jogadores = await lerRankingAoVivo();
    if (!jogadores.length || Number(jogadores[0].points) <= 0) return { pulado: "ranking_zerado" };

    const r = await temporadas.salvar({
      id: agora.id,
      jogadores,
      origem: "automatico",
      tirado_em: new Date().toISOString(),
    });
    if (r.ok) console.log(`[Temporadas] ${r.temporada.nome} fechada automaticamente (${jogadores.length} jogadores).`);
    return r.ok ? { criado: true, id: agora.id } : { pulado: r.motivo };
  } finally {
    fechamentoEmAndamento = false;
  }
}

// Rota pro cron externo (mesma CRON_SECRET do config). Desligada se a variavel nao existir.
app.all("/api/cron/fechar-temporada", async (req, res) => {
  if (!config.cronSecret) return res.status(404).json({ error: "Não encontrado." });
  const chave = String(req.query.key || req.headers["x-cron-key"] || "");
  const a = Buffer.from(chave);
  const b = Buffer.from(config.cronSecret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Chave inválida." });
  }
  try {
    res.json(await fecharMesAutomatico());
  } catch (err) {
    console.error("[Temporadas] Falha no cron:", err.message);
    res.status(500).json({ error: "Erro ao fechar a temporada." });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Mix Dashboard rodando em http://localhost:${PORT}`);
});

// Confere uma vez por minuto se e hora de fechar a temporada do mes.
setInterval(() => {
  fecharMesAutomatico().catch((err) => console.error("[Temporadas] Falha no fechamento automático:", err.message));
}, 60 * 1000).unref();
