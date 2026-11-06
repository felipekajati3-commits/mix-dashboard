// ============================================================
//  CORTE DO HISTORICO DE PARTIDAS: data a partir da qual a aba
//  "Histórico de Partidas" mostra partidas. Nao apaga nada do banco:
//  so esconde o que veio antes. Serve pra recomecar a temporada.
//
//  Mesmo esquema do snapshot.js: um JSON na branch "data" do GitHub
//  (o Render apaga o disco a cada deploy). Sem token, usa arquivo local.
// ============================================================

const fs = require("fs/promises");
const path = require("path");
const config = require("./config");

const LOCAL = path.join(__dirname, "corte-historico.local.json");
const TTL_MS = 15 * 1000;
let cache = null, expira = 0, sha = null;

const usaGitHub = () => Boolean(config.github.token && config.github.repo);
const nomeArquivo = () => config.github.arquivoCorte || "corte-historico.json";
const urlConteudo = () => `https://api.github.com/repos/${config.github.repo}/contents/${nomeArquivo()}`;
const headers = () => ({
  Authorization: `Bearer ${config.github.token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "mix-dashboard",
});

function normalizar(d) {
  const ok = d && typeof d.desde === "string" && !Number.isNaN(Date.parse(d.desde));
  return { desde: ok ? new Date(d.desde).toISOString() : null };
}

async function lerGitHub() {
  const resp = await fetch(`${urlConteudo()}?ref=${encodeURIComponent(config.github.branch)}`, { headers: headers() });
  if (resp.status === 404) { sha = null; return { desde: null }; }
  if (!resp.ok) throw new Error(`GitHub respondeu ${resp.status} ao ler o corte.`);
  const body = await resp.json();
  sha = body.sha;
  return normalizar(JSON.parse(Buffer.from(body.content || "", "base64").toString("utf8") || "{}"));
}

async function gravarGitHub(dados) {
  try { await lerGitHub(); } catch (err) { console.warn("[Corte] não consegui reler o sha:", err.message); }
  const corpo = {
    message: `corte-historico: ${dados.desde || "removido"}`,
    content: Buffer.from(JSON.stringify(dados, null, 2), "utf8").toString("base64"),
    branch: config.github.branch,
  };
  if (sha) corpo.sha = sha;
  const resp = await fetch(urlConteudo(), { method: "PUT", headers: { ...headers(), "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  if (!resp.ok) throw new Error(`GitHub respondeu ${resp.status} ao salvar o corte: ${(await resp.text()).slice(0, 200)}`);
  sha = (await resp.json()).content?.sha || null;
}

async function ler({ forcar = false } = {}) {
  if (!forcar && cache && Date.now() < expira) return cache;
  let dados;
  if (usaGitHub()) dados = await lerGitHub();
  else dados = await fs.readFile(LOCAL, "utf8").then((t) => normalizar(JSON.parse(t))).catch(() => ({ desde: null }));
  cache = dados; expira = Date.now() + TTL_MS;
  return dados;
}

// desde = ISO (esconde partidas anteriores) ou null (mostra tudo de novo)
async function definir(desde) {
  const dados = normalizar({ desde });
  if (usaGitHub()) await gravarGitHub(dados);
  else await fs.writeFile(LOCAL, JSON.stringify(dados, null, 2), "utf8");
  cache = dados; expira = Date.now() + TTL_MS;
  return dados;
}

module.exports = { ler, definir, usaGitHub };
