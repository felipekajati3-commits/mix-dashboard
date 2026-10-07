// ============================================================
//  SNAPSHOT DO RANKING (auditoria)
//
//  Guarda DUAS fotos do ranking (pontos + estatisticas do K4-System),
//  tiradas manualmente pelo admin: a mais recente ("atual") e a
//  anterior a ela. Ao tirar uma foto nova, a atual vira a "anterior" e
//  a anterior antiga e descartada - nunca ha mais que 2.
//  No arquivo, os campos da foto atual ficam na raiz e a anterior fica
//  dentro de "anterior" (assim arquivos antigos, de 1 foto, continuam
//  validos).
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

const ESTRUTURA_VAZIA = { tirado_em: null, motivo: null, total: 0, jogadores: [], anterior: null };

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

// Normaliza UMA foto (sem o campo "anterior").
function normalizarFoto(dados) {
  const jogadores = Array.isArray(dados?.jogadores) ? dados.jogadores : [];
  return {
    tirado_em: dados?.tirado_em || null,
    motivo: dados?.motivo || null,
    total: jogadores.length,
    jogadores,
  };
}

function normalizar(dados) {
  if (!dados || typeof dados !== "object") return { ...ESTRUTURA_VAZIA };
  const anterior = dados.anterior && dados.anterior.tirado_em ? normalizarFoto(dados.anterior) : null;
  return { ...normalizarFoto(dados), anterior };
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

// Guarda o snapshot novo como "atual" e passa o atual de antes para
// "anterior" (o penultimo e descartado).
async function salvar(dados) {
  const atualAntes = await ler({ forcar: true });
  const anterior = atualAntes.tirado_em ? normalizarFoto(atualAntes) : null;
  const normalizado = normalizar({ ...dados, anterior });
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
