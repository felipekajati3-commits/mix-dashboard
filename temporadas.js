// ============================================================
//  TEMPORADAS (ranking mensal)
//
//  Todo mes o ranking e "fechado" e guardado aqui como uma temporada
//  (ex.: "Outubro 2026"), e os pontos sao zerados no K4-System.
//  Diferente do snapshot.js (que guarda so as 2 ultimas fotos), as
//  temporadas sao PERMANENTES: nada aqui e apagado sozinho.
//
//  Mesmo mecanismo do snapshot.js/historico.js: um JSON commitado na
//  branch "data" via API do GitHub (o Render apaga o disco a cada
//  deploy). Sem token configurado, cai pra um arquivo local (so serve
//  pra testar).
//
//  Formato do arquivo:
//  { "temporadas": [
//      { "id": "2026-10", "nome": "Outubro 2026", "fechado_em": "...ISO...",
//        "origem": "snapshot_atual" | "snapshot_anterior" | "ranking" | "automatico",
//        "tirado_em": "...ISO... (quando as fotos dos pontos foram tiradas)",
//        "jogadores": [ { pos, steam_id, name, points, v, d, k, m, a, hs } ] }
//  ] }
// ============================================================

const fs = require("fs/promises");
const path = require("path");
const config = require("./config");

const ARQUIVO_LOCAL = path.join(__dirname, "temporadas.local.json");
const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

let cache = null;
let cacheExpiraEm = 0;
let shaAtual = null;
const CACHE_MS = 15 * 1000;

// Leitura-modificacao-escrita nao pode acontecer em paralelo, senao
// uma gravacao apaga a outra. Esta fila garante uma de cada vez.
let fila = Promise.resolve();
function emSerie(fn) {
  const proxima = fila.then(fn, fn);
  fila = proxima.catch(() => {});
  return proxima;
}

function usandoGitHub() {
  return Boolean(config.github.token && config.github.repo);
}

function nomeArquivo() {
  return config.github.arquivoTemporadas || "temporadas.json";
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

// "2026-10" -> "Outubro 2026". Devolve null se o formato for invalido.
function nomeDoMes(id) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(id || ""));
  if (!m) return null;
  return `${MESES[Number(m[2]) - 1]} ${m[1]}`;
}

function normalizar(dados) {
  const lista = Array.isArray(dados?.temporadas) ? dados.temporadas : [];
  return { temporadas: lista.filter((t) => t && nomeDoMes(t.id)) };
}

async function lerDoGitHub() {
  const url = `${urlConteudo()}?ref=${encodeURIComponent(config.github.branch)}`;
  const resp = await fetch(url, { headers: headersGitHub() });

  // 404 = ainda nao existe nenhuma temporada - normal na primeira vez.
  if (resp.status === 404) {
    shaAtual = null;
    return { temporadas: [] };
  }
  if (!resp.ok) throw new Error(`GitHub respondeu ${resp.status} ao ler as temporadas.`);

  const body = await resp.json();
  shaAtual = body.sha;
  const texto = Buffer.from(body.content || "", "base64").toString("utf8");
  return normalizar(JSON.parse(texto || "{}"));
}

async function gravarNoGitHub(dados, mensagem) {
  await lerDoGitHub(); // pega o sha mais recente (o GitHub exige pra sobrescrever)

  const corpo = {
    message: `temporadas: ${mensagem}`,
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
    throw new Error(`GitHub respondeu ${resp.status} ao salvar as temporadas: ${detalhe.slice(0, 200)}`);
  }
  const body = await resp.json();
  shaAtual = body.content?.sha || null;
}

async function lerLocal() {
  try {
    return normalizar(JSON.parse(await fs.readFile(ARQUIVO_LOCAL, "utf8")));
  } catch (err) {
    return { temporadas: [] };
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

async function gravar(dados, mensagem) {
  if (usandoGitHub()) await gravarNoGitHub(dados, mensagem);
  else await gravarLocal(dados);
  cache = dados;
  cacheExpiraEm = Date.now() + CACHE_MS;
}

// Mais recente primeiro.
function ordenar(lista) {
  return [...lista].sort((a, b) => (a.id < b.id ? 1 : -1));
}

async function listar() {
  const dados = await ler();
  return ordenar(dados.temporadas);
}

async function obter(id) {
  const dados = await ler();
  return dados.temporadas.find((t) => t.id === id) || null;
}

// Cria (ou, com substituir=true, troca) a temporada do mes `id` ("AAAA-MM").
// Devolve { ok: true, temporada } ou { ok: false, motivo }.
function salvar({ id, jogadores, origem, tirado_em, substituir = false }) {
  return emSerie(async () => {
    const nome = nomeDoMes(id);
    if (!nome) return { ok: false, motivo: "mes_invalido" };
    if (!Array.isArray(jogadores) || !jogadores.length) return { ok: false, motivo: "sem_jogadores" };

    const dados = await ler({ forcar: true });
    const existe = dados.temporadas.some((t) => t.id === id);
    if (existe && !substituir) return { ok: false, motivo: "ja_existe" };

    const ordenados = [...jogadores]
      .sort((a, b) => Number(b.points || 0) - Number(a.points || 0))
      .map((j, i) => ({ ...j, pos: i + 1 }));

    const temporada = {
      id,
      nome,
      fechado_em: new Date().toISOString(),
      origem: origem || "manual",
      tirado_em: tirado_em || null,
      jogadores: ordenados,
    };

    const novo = { temporadas: ordenar([...dados.temporadas.filter((t) => t.id !== id), temporada]) };
    await gravar(novo, `${existe ? "substitui" : "fecha"} ${nome}`);
    return { ok: true, temporada };
  });
}

function remover(id) {
  return emSerie(async () => {
    const dados = await ler({ forcar: true });
    const alvo = dados.temporadas.find((t) => t.id === id);
    if (!alvo) return { ok: false, motivo: "nao_encontrada" };
    await gravar({ temporadas: dados.temporadas.filter((t) => t.id !== id) }, `remove ${alvo.nome}`);
    return { ok: true };
  });
}

module.exports = { listar, obter, salvar, remover, nomeDoMes, usandoGitHub };
