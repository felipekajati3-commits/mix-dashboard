// ============================================================
//  HISTORICO DE PARTIDAS - registro bruto de quem venceu cada
//  partida, recebido via webhook do MatchZy (evento "series_end").
//
//  Serve como fonte independente de verdade: o MatchZy manda esse
//  evento direto do servidor de jogo, sem passar pelo K4-System. Dá
//  pra comparar esse historico com o que o K4-System contabilizou
//  (vitorias/derrotas/partidas) e achar partida que sumiu ou foi
//  contada errado.
//
//  Depois de conferir, o admin limpa (POST /limpar) e comeca a
//  proxima conferencia do zero - por isso isso fica separado dos
//  rankings, que sao permanentes.
//
//  Usa o mesmo mecanismo de persistencia do store.js (um JSON
//  commitado na branch "data" do repositorio, via API do GitHub),
//  porque o Render apaga o disco a cada deploy/restart. Sem token
//  configurado, cai pra um arquivo local (so serve pra testar).
// ============================================================

const fs = require("fs/promises");
const path = require("path");
const config = require("./config");

const ARQUIVO_LOCAL = path.join(__dirname, "historico-partidas.local.json");

// Nao deixa crescer pra sempre - depois de um tempo sem o admin
// limpar, os mais antigos vao caindo fora sozinhos.
const MAX_REGISTROS = 500;

const ESTRUTURA_VAZIA = { partidas: [], atualizado_em: null };

// Cache curto: como isso e usado pra auditoria (o admin quer ver a
// partida que acabou de terminar), um cache muito longo atrapalharia.
let cache = null;
let cacheExpiraEm = 0;
let shaAtual = null;
const CACHE_MS = 15 * 1000;

function usandoGitHub() {
  return Boolean(config.github.token && config.github.repo);
}

function nomeArquivo() {
  return config.github.arquivoHistorico || "historico-partidas.json";
}

function urlConteudo() {
  return `https://api.github.com/repos/${config.github.repo}/contents/${nomeArquivo()}`;
}

function headersGitHub() {
  return {
    Authorization: `Bearer ${config.github.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "mix-dashboard",
  };
}

function normalizar(dados) {
  if (!dados || typeof dados !== "object") return { ...ESTRUTURA_VAZIA };
  const partidas = Array.isArray(dados.partidas) ? dados.partidas : [];
  return {
    partidas: partidas.filter((p) => p && typeof p === "object"),
    atualizado_em: dados.atualizado_em || null,
  };
}

async function lerDoGitHub() {
  const url = `${urlConteudo()}?ref=${encodeURIComponent(config.github.branch)}`;
  const resp = await fetch(url, { headers: headersGitHub() });

  // 404 = ainda nao existe nenhuma partida registrada - normal na
  // primeira vez. Comeca vazio e cria no primeiro registro.
  if (resp.status === 404) {
    shaAtual = null;
    return { ...ESTRUTURA_VAZIA };
  }
  if (!resp.ok) {
    throw new Error(`GitHub respondeu ${resp.status} ao ler o histórico.`);
  }

  const body = await resp.json();
  shaAtual = body.sha;
  const texto = Buffer.from(body.content || "", "base64").toString("utf8");
  return normalizar(JSON.parse(texto || "{}"));
}

async function gravarNoGitHub(dados) {
  try {
    await lerDoGitHub();
  } catch (err) {
    console.warn("[Histórico] Não consegui reler o sha antes de gravar:", err.message);
  }

  const corpo = {
    message: `historico-partidas: atualizado em ${new Date().toISOString()}`,
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
    throw new Error(`GitHub respondeu ${resp.status} ao salvar o histórico: ${detalhe.slice(0, 200)}`);
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

async function ler({ forcar = false } = {}) {
  if (!forcar && cache && Date.now() < cacheExpiraEm) return cache;
  const dados = usandoGitHub() ? await lerDoGitHub() : await lerLocal();
  cache = dados;
  cacheExpiraEm = Date.now() + CACHE_MS;
  return dados;
}

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

function criarId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// Registra uma partida nova. O MatchZy avisa que "nao ha deduplicacao
// de eventos" (pode mandar o mesmo duas vezes se a rede falhar) - por
// isso aceita uma "chaveDedup" (ex: matchid+numero do mapa) e ignora
// silenciosamente se ela bater com o registro mais recente.
async function registrar(partida, { chaveDedup = null } = {}) {
  const atuais = await ler({ forcar: true });

  if (chaveDedup && atuais.partidas[0]?._chaveDedup === chaveDedup) {
    return atuais; // mesmo evento chegou de novo - ignora
  }

  const novoRegistro = { id: criarId(), ...partida, _chaveDedup: chaveDedup };
  const partidas = [novoRegistro, ...atuais.partidas].slice(0, MAX_REGISTROS);
  return persistir({ partidas, atualizado_em: new Date().toISOString() });
}

// Apaga tudo - usado pelo admin depois de conferir contra o K4-System.
async function limpar() {
  return persistir({ partidas: [], atualizado_em: new Date().toISOString() });
}

// Inverte Time A <-> Time B no vencedor e no placar de uma partida (correcao
// manual quando o MatchZy numerou os times ao contrario). Chamar de novo desfaz.
async function inverter(id) {
  const atuais = await ler({ forcar: true });
  const idx = atuais.partidas.findIndex((p) => p.id === id);
  if (idx === -1) return null;

  const p = atuais.partidas[idx];
  const trocaTime = (v) => (v === "A" ? "B" : v === "B" ? "A" : v);
  const corrigido = {
    ...p,
    vencedor: trocaTime(p.vencedor),
    placarA: p.placarB,
    placarB: p.placarA,
    corrigido_manual: !p.corrigido_manual,
  };
  const partidas = atuais.partidas.slice();
  partidas[idx] = corrigido;
  return persistir({ partidas, atualizado_em: new Date().toISOString() });
}

module.exports = { ler, registrar, limpar, inverter, usandoGitHub };
