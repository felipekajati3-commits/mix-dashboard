// ============================================================
//  PARTIDAS OCULTAS: IDs de partidas (matchid do MatchZy) que o admin
//  "excluiu" do Histórico de Partidas. Nao apaga nada do banco: so
//  esconde da lista (e da busca de jogadores). Da pra restaurar.
//
//  Mesmo esquema do corte.js: um JSON na branch "data" do GitHub
//  (o Render apaga o disco a cada deploy). Sem token, usa arquivo local.
// ============================================================

const fs = require("fs/promises");
const path = require("path");
const config = require("./config");

const LOCAL = path.join(__dirname, "partidas-ocultas.local.json");
const TTL_MS = 15 * 1000;
let cache = null, expira = 0, sha = null;

const usaGitHub = () => Boolean(config.github.token && config.github.repo);
const nomeArquivo = () => config.github.arquivoOcultas || "partidas-ocultas.json";
const urlConteudo = () => `https://api.github.com/repos/${config.github.repo}/contents/${nomeArquivo()}`;
const headers = () => ({
  Authorization: `Bearer ${config.github.token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "mix-dashboard",
});

function normalizar(d) {
  const ids = Array.isArray(d?.ids) ? d.ids.map(String).filter((x) => /^\d+$/.test(x)) : [];
  return { ids: [...new Set(ids)] };
}

async function lerGitHub() {
  const resp = await fetch(`${urlConteudo()}?ref=${encodeURIComponent(config.github.branch)}`, { headers: headers() });
  if (resp.status === 404) { sha = null; return { ids: [] }; }
  if (!resp.ok) throw new Error(`GitHub respondeu ${resp.status} ao ler as partidas ocultas.`);
  const body = await resp.json();
  sha = body.sha;
  return normalizar(JSON.parse(Buffer.from(body.content || "", "base64").toString("utf8") || "{}"));
}

async function gravarGitHub(dados) {
  try { await lerGitHub(); } catch (err) { console.warn("[Ocultas] não consegui reler o sha:", err.message); }
  const corpo = {
    message: `partidas-ocultas: ${dados.ids.length} oculta(s)`,
    content: Buffer.from(JSON.stringify(dados, null, 2), "utf8").toString("base64"),
    branch: config.github.branch,
  };
  if (sha) corpo.sha = sha;
  const resp = await fetch(urlConteudo(), { method: "PUT", headers: { ...headers(), "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  if (!resp.ok) throw new Error(`GitHub respondeu ${resp.status} ao salvar as partidas ocultas: ${(await resp.text()).slice(0, 200)}`);
  sha = (await resp.json()).content?.sha || null;
}

async function ler({ forcar = false } = {}) {
  if (!forcar && cache && Date.now() < expira) return cache;
  let dados;
  if (usaGitHub()) dados = await lerGitHub();
  else dados = await fs.readFile(LOCAL, "utf8").then((t) => normalizar(JSON.parse(t))).catch(() => ({ ids: [] }));
  cache = dados; expira = Date.now() + TTL_MS;
  return dados;
}

async function persistir(dados) {
  if (usaGitHub()) await gravarGitHub(dados);
  else await fs.writeFile(LOCAL, JSON.stringify(dados, null, 2), "utf8");
  cache = dados; expira = Date.now() + TTL_MS;
  return dados;
}

async function ocultar(id) {
  const atuais = await ler({ forcar: true });
  return persistir(normalizar({ ids: [...atuais.ids, String(id)] }));
}

async function restaurar(id) {
  const atuais = await ler({ forcar: true });
  return persistir({ ids: atuais.ids.filter((x) => x !== String(id)) });
}

module.exports = { ler, ocultar, restaurar, usaGitHub };
