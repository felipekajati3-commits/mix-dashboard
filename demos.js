// ============================================================
//  DEMOS DAS PARTIDAS (botão "Baixar demo" no Histórico)
//
//  As demos ficam na pasta do MatchZy no servidor de CS2 (painel
//  Pterodactyl da FireGames). O site pergunta ao painel, pela API, qual
//  arquivo é de cada partida (o ID da partida está no nome do arquivo) e
//  pede um link de download temporário. O arquivo grande vai direto do
//  servidor de jogo pro navegador, sem passar pelo Render.
//
//  Variáveis de ambiente (no Render, NUNCA no código):
//    PTERO_URL     ex: https://painel2.firegamesnetwork.com
//    PTERO_SERVER  ex: be1b37df (o código que aparece na URL do painel)
//    PTERO_KEY     chave de API (de um usuário só com permissão de leitura)
//    PTERO_DIR     opcional, padrão /game/csgo/MatchZy
//  Sem as três primeiras, o botão simplesmente não aparece.
// ============================================================

const cfg = () => ({
  url: (process.env.PTERO_URL || "").replace(/\/+$/, ""),
  server: process.env.PTERO_SERVER || "",
  key: process.env.PTERO_KEY || "",
  dir: process.env.PTERO_DIR || "/game/csgo/MatchZy",
});
const configurado = () => { const c = cfg(); return Boolean(c.url && c.server && c.key); };

async function api(caminho) {
  const c = cfg();
  const resp = await fetch(`${c.url}/api/client/servers/${c.server}${caminho}`, {
    headers: { Authorization: `Bearer ${c.key}`, Accept: "application/vnd.pterodactyl.v1+json" },
  });
  if (!resp.ok) throw new Error(`Painel respondeu ${resp.status}`);
  return resp.json();
}

// { "1570": { nome: "2026-11-02_05-08-38_1570_de_overpass_....dem", tamanho: bytes } }
let cache = null, expira = 0;
async function mapa() {
  if (!configurado()) return {};
  if (cache && Date.now() < expira) return cache;
  const j = await api(`/files/list?directory=${encodeURIComponent(cfg().dir)}`);
  const m = {};
  for (const f of j.data || []) {
    const a = f.attributes || {};
    if (!a.is_file || !/\.dem$/i.test(a.name)) continue;
    // formato do MatchZy: {TIME}_{MATCH_ID}_{MAP}_{TEAM1}_vs_{TEAM2}.dem
    const x = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_(\d+)_/.exec(a.name);
    if (x && (!m[x[1]] || a.name > m[x[1]].nome)) m[x[1]] = { nome: a.name, tamanho: Number(a.size) || 0 };
  }
  cache = m; expira = Date.now() + 60 * 1000;
  return m;
}

// Link temporário (o painel vence em poucos minutos) ou null se não há demo.
async function linkDownload(matchid) {
  const d = (await mapa())[String(matchid)];
  if (!d) return null;
  const j = await api(`/files/download?file=${encodeURIComponent(cfg().dir + "/" + d.nome)}`);
  return j.attributes?.url || null;
}

module.exports = { mapa, linkDownload, configurado };
