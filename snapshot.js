// ============================================================
//  SNAPSHOT DO RANKING (auditoria)
//
//  Guarda UMA foto do ranking (pontos + estatisticas do K4-System)
//  tirada todo dia as 7h (horario de Brasilia). Cada foto nova
//  SUBSTITUI a anterior - nao existe historico de varios dias.
//
//  Usa o mesmo mecanismo do historico.js: um JSON commitado na branch
//  "data" via API do GitHub, porque o Render apaga o disco a cada
//  deploy/restart. Sem token configurado, cai pra um arquivo local
//  (so serve pra testar).
// ============================================================

const fs = require("fs/promises");
const path = require("path");
const config = require("./config");

const ARQUIVO_LOCAL = path.join(__dirname, "snapshot-ranking.local.json");

const ESTRUTURA_VAZIA = { tirado_em: null, motivo: null, total: 0, jogadores: [] };

let cache = null;
let cacheExpiraEm = 0;
let shaAtual = null;
const CACHE_MS = 15 * 1000;

function usandoGitHub() {
  return Boolean(config.github.token && config.github.repo);
}

function nomeArquivo() {
  return config.github.arquivoSnapshot || "snapshot-ranking.json";
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
  const jogadores = Array.isArray(dados.jogadores) ? dados.jogadores : [];
  return {
    tirado_em: dados.tirado_em || null,
    motivo: dados.motivo || null,
    total: jogadores.length,
    jogadores,
  };
}

async function lerDoGitHub() {
  const url = `${urlConteudo()}?ref=${encodeURIComponent(config.github.branch)}`;
  const resp = await fetch(url, { headers: headersGitHub() });

  // 404 = ainda nao existe nenhum snapshot - normal na primeira vez.
  if (resp.status === 404) {
    shaAtual = null;
    return { ...ESTRUTURA_VAZIA };
  }
  if (!resp.ok) {
    throw new Error(`GitHub respondeu ${resp.status} ao ler o snapshot.`);
  }

  const body = await resp.json();
  shaAtual = body.sha;
  const texto = Buffer.from(body.content || "", "base64").toString("utf8");
  return normalizar(JSON.parse(texto || "{}"));
}

async function gravarNoGitHub(dados) {
  // Pega o sha mais recente (o GitHub exige pra sobrescrever um arquivo).
  await lerDoGitHub();

  const corpo = {
    message: `snapshot-ranking: ${dados.tirado_em}`,
    content: Buffer.from(JSON.stringify(dados), "utf8").toString("base64"),
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
    throw new Error(`GitHub respondeu ${resp.status} ao salvar o snapshot: ${detalhe.slice(0, 200)}`);
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
  await fs.writeFile(ARQUIVO_LOCAL, JSON.stringify(dados), "utf8");
}

// ---------------- API publica do modulo ----------------

async function ler({ forcar = false } = {}) {
  if (!forcar && cache && Date.now() < cacheExpiraEm) return cache;
  const dados = usandoGitHub() ? await lerDoGitHub() : await lerLocal();
  cache = dados;
  cacheExpiraEm = Date.now() + CACHE_MS;
  return dados;
}

// Substitui o snapshot anterior pelo novo.
async function salvar(dados) {
  const normalizado = normalizar(dados);
  if (usandoGitHub()) {
    await gravarNoGitHub(normalizado);
  } else {
    await gravarLocal(normalizado);
  }
  cache = normalizado;
  cacheExpiraEm = Date.now() + CACHE_MS;
  return normalizado;
}

module.exports = { ler, salvar, usandoGitHub };
