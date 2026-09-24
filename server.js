const express = require("express");
const mysql = require("mysql2/promise");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const config = require("./config");
const store = require("./store");

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
app.get("/api/leaderboard", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT steam_id, name, points
       FROM rank_mix_k4ranks
       ORDER BY points DESC
       LIMIT ?`,
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

  if (evento.event === "map_result") {
    const placarA = extrairPlacarDeRounds(evento.team1);
    const placarB = extrairPlacarDeRounds(evento.team2);

    if (placarA !== null && placarB !== null) {
      ultimoPlacarDeRounds = { placarA, placarB };
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

  // O MatchZy chama de "team1" o time que começou do lado CT e "team2" o
  // que começou do lado T (o nosso plugin já coloca Time A na CT e Time B
  // na T ao entrar). Então: team1 = Time A, team2 = Time B.
  let vencedor = null;
  if (evento.winner?.team === "team1") vencedor = "A";
  else if (evento.winner?.team === "team2") vencedor = "B";

  ultimoResultadoPartida = {
    criado_em: new Date(),
    vencedor, // "A" | "B" | null (null = empate ou sem vencedor)
    // Preferimos o placar de rounds real (do map_result); se por algum
    // motivo ele não chegou, caímos pro placar de mapas ganhos na série
    // (que em BO1 é sempre 1x0, mas é melhor que nada).
    placarA: ultimoPlacarDeRounds?.placarA ?? evento.team1_series_score ?? null,
    placarB: ultimoPlacarDeRounds?.placarB ?? evento.team2_series_score ?? null,
  };

  ultimoPlacarDeRounds = null; // limpa pra não vazar pra próxima partida

  // Se ainda tiver o sorteio dessa rodada no histórico do dia, anexa o
  // resultado nele também, pra aparecer junto na lista de sorteios de hoje.
  if (historicoSorteios.length > 0) {
    historicoSorteios[historicoSorteios.length - 1].resultado = ultimoResultadoPartida;
  }

  io.emit("partida:resultado", ultimoResultadoPartida);

  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Mix Dashboard rodando em http://localhost:${PORT}`);
});
