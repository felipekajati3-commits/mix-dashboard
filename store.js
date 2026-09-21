// ============================================================
//  STORE - onde os rankings manuais ficam guardados
//
//  O Render apaga o disco a cada deploy/restart, entao salvar num
//  arquivo local nao serve: os rankings sumiriam sozinhos. A solucao
//  aqui e guardar um JSON numa branch separada do proprio repositorio
//  (a branch "data"), gravando pela API do GitHub com um token.
//
//  Vantagens: nao precisa de banco novo, e da pra ver/editar o
//  historico direto pelo GitHub se algo der errado.
//
//  Se nao tiver token configurado (rodando na sua maquina, por
//  exemplo), ele cai automaticamente pra um arquivo local
//  "rankings.local.json", pra dar pra testar sem GitHub nenhum.
// ============================================================

const fs = require("fs/promises");
const path = require("path");
const config = require("./config");

const ARQUIVO_LOCAL = path.join(__dirname, "rankings.local.json");

const ESTRUTURA_VAZIA = {
  // { id, tipo: "steam"|"vaga", steam_id, nome, tier,
  //   tier_anterior, movido_em }  <- os dois ultimos alimentam as setas
  //   de subiu/desceu na aba Ranking (ver salvar()).
  jogadores: [],
  atualizado_em: null,
};

// Cache em memoria: o site inteiro le os rankings a cada visita, e
// bater na API do GitHub toda vez seria lento e estouraria o limite
// de chamadas. Entao lemos de verdade no maximo 1x por minuto.
let cache = null;
let cacheExpiraEm = 0;
let shaAtual = null; // o GitHub exige o sha do arquivo pra sobrescrever
const CACHE_MS = 60 * 1000;

function usandoGitHub() {
  return Boolean(config.github.token && config.github.repo);
}

function urlConteudo() {
  return `https://api.github.com/repos/${config.github.repo}/contents/${config.github.arquivo}`;
}

function headersGitHub() {
  return {
    Authorization: `Bearer ${config.github.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "mix-dashboard",
  };
}

// Garante que o que veio do arquivo tem o formato esperado, mesmo que
// alguem tenha editado o JSON na mao e escorregado em algo.
function normalizar(dados) {
  if (!dados || typeof dados !== "object") return { ...ESTRUTURA_VAZIA };
  const jogadores = Array.isArray(dados.jogadores) ? dados.jogadores : [];
  return {
    jogadores: jogadores
      .filter((j) => j && typeof j.nome === "string")
      .map((j) => ({
        id: String(j.id || criarId()),
        tipo: j.tipo === "vaga" ? "vaga" : "steam",
        steam_id: j.steam_id ? String(j.steam_id) : null,
        nome: String(j.nome).slice(0, 40),
        tier: Math.min(5, Math.max(1, Number(j.tier) || 3)),
        tier_anterior: tierValido(j.tier_anterior),
        movido_em: j.movido_em ? String(j.movido_em) : null,
      })),
    atualizado_em: dados.atualizado_em || null,
  };
}

// Devolve o nivel (1 a 5) ou null quando nao ha nivel anterior guardado.
function tierValido(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

function criarId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

async function lerDoGitHub() {
  const url = `${urlConteudo()}?ref=${encodeURIComponent(config.github.branch)}`;
  const resp = await fetch(url, { headers: headersGitHub() });

  // 404 = o arquivo ainda nao existe na branch (primeira vez que o
  // site roda). Isso e normal: comeca vazio e cria no primeiro save.
  if (resp.status === 404) {
    shaAtual = null;
    return { ...ESTRUTURA_VAZIA };
  }

  if (!resp.ok) {
    throw new Error(`GitHub respondeu ${resp.status} ao ler os rankings.`);
  }

  const body = await resp.json();
  shaAtual = body.sha;
  const texto = Buffer.from(body.content || "", "base64").toString("utf8");
  return normalizar(JSON.parse(texto || "{}"));
}

async function gravarNoGitHub(dados) {
  // Relemos o sha antes de gravar: se outra aba salvou no meio do
  // caminho, o sha que temos em cache esta velho e o GitHub recusaria.
  try {
    await lerDoGitHub();
  } catch (err) {
    // Se a leitura falhou, tentamos gravar assim mesmo com o sha que
    // temos - na pior das hipoteses o erro aparece logo abaixo.
    console.warn("Não consegui reler o sha antes de gravar:", err.message);
  }

  const corpo = {
    message: `rankings: atualizado em ${new Date().toISOString()}`,
    content: Buffer.from(JSON.stringify(dados, null, 2), "utf8").toString("base64"),
    branch: config.github.branch,
  };
  if (shaAtual) corpo.sha = shaAtual;

  const resp = await fetch(urlConteudo(), {
    method: "PUT",
    headers: { ...headersGitHub(), "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });

  if (!resp.ok) {
    const detalhe = await resp.text();
    throw new Error(`GitHub respondeu ${resp.status} ao salvar: ${detalhe.slice(0, 200)}`);
  }

  const body = await resp.json();
  shaAtual = body.content?.sha || null;
}

async function lerLocal() {
  try {
    const texto = await fs.readFile(ARQUIVO_LOCAL, "utf8");
    return normalizar(JSON.parse(texto));
  } catch (err) {
    return { ...ESTRUTURA_VAZIA };
  }
}

async function gravarLocal(dados) {
  await fs.writeFile(ARQUIVO_LOCAL, JSON.stringify(dados, null, 2), "utf8");
}

// ---------------- API publica do modulo ----------------

// Le os rankings, usando o cache quando ele ainda esta fresco.
async function ler({ forcar = false } = {}) {
  if (!forcar && cache && Date.now() < cacheExpiraEm) return cache;

  const dados = usandoGitHub() ? await lerDoGitHub() : await lerLocal();
  cache = dados;
  cacheExpiraEm = Date.now() + CACHE_MS;
  return dados;
}

// Grava (GitHub ou arquivo local) e atualiza o cache.
async function persistir(dados) {
  if (usandoGitHub()) {
    await gravarNoGitHub(dados);
  } else {
    await gravarLocal(dados);
  }

  cache = dados;
  cacheExpiraEm = Date.now() + CACHE_MS;
  return dados;
}

// Salva a lista inteira de jogadores de uma vez (e como a tela de
// admin funciona: voce edita tudo e clica em salvar uma vez so).
//
// E aqui que nascem as setas do ranking: comparamos o nivel de cada
// jogador com o que ja estava salvo. Se mudou, guardamos o nivel
// antigo em "tier_anterior" (e quando foi em "movido_em"). Se nao
// mudou, mantemos o que ja tinha - entao a seta continua la ate a
// proxima mudanca ou ate o admin clicar em "Zerar setas". O cliente
// nunca manda esses campos: quem decide e sempre o servidor.
async function salvar(jogadores) {
  const novos = normalizar({ jogadores }).jogadores;

  let atuais = [];
  try {
    atuais = (await ler({ forcar: true })).jogadores;
  } catch (err) {
    // Sem conseguir ler o que ja existe, melhor salvar sem setas do que
    // perder a edicao do admin.
    console.warn("Não consegui ler os rankings antes de salvar:", err.message);
  }
  const antesPorId = new Map(atuais.map((j) => [j.id, j]));
  const agora = new Date().toISOString();

  const comSetas = novos.map((j) => {
    const antes = antesPorId.get(j.id);
    if (!antes) return { ...j, tier_anterior: null, movido_em: null }; // jogador novo
    if (antes.tier !== j.tier) return { ...j, tier_anterior: antes.tier, movido_em: agora };
    return { ...j, tier_anterior: antes.tier_anterior, movido_em: antes.movido_em };
  });

  return persistir({ jogadores: comSetas, atualizado_em: agora });
}

// Apaga todas as setas (todo mundo volta pro "-"), sem mexer em nivel
// nem em nome de ninguem.
async function zerarSetas() {
  const atuais = await ler({ forcar: true });
  const limpos = atuais.jogadores.map((j) => ({ ...j, tier_anterior: null, movido_em: null }));
  return persistir({ jogadores: limpos, atualizado_em: new Date().toISOString() });
}

module.exports = { ler, salvar, zerarSetas, criarId, usandoGitHub };
