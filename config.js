// ============================================================
//  CONFIGURACAO
//  Localmente, usa os valores abaixo. Quando hospedado (Render,
//  Railway, etc), as variaveis de ambiente definidas no painel do
//  host substituem esses valores automaticamente - assim a senha
//  nunca precisa ir pro codigo que fica no GitHub.
// ============================================================

module.exports = {
  db: {
    host: process.env.DB_HOST || "177.54.146.23",
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || "u15_Z4xAppBzp5",
    password: process.env.DB_PASSWORD || "HaZsko+jKMTeubchGRUAA.j!",
    database: process.env.DB_NAME || "s15_server",
  },

  steamApiKey: process.env.STEAM_API_KEY || "04B6564650DCBC25DA0677E4E8DACC1A",

  // Senha compartilhada com o plugin do servidor de CS2 (o mesmo valor
  // precisa estar configurado lá). Só quem souber essa senha consegue
  // consultar o time de um jogador pela rota /api/plugin/time/:steam_id.
  // IMPORTANTE: troque esse valor por algo só seu antes de usar.
  pluginSecret: process.env.PLUGIN_SECRET || "troque-essa-senha-agora",

  leaderboardLimit: 50,

  // ---------------- Painel de admin ----------------
  // Senha pra entrar em /admin.html e editar os rankings manuais.
  // Defina ADMIN_PASSWORD no painel do Render - o valor abaixo e so
  // um padrao inseguro pra rodar na sua maquina.
  adminPassword: process.env.ADMIN_PASSWORD || "admin",

  // Segredo usado pra assinar o cookie de login do admin. Se mudar,
  // todo mundo que estava logado precisa entrar de novo.
  sessionSecret: process.env.SESSION_SECRET || "troque-esse-segredo",

  // Quanto tempo o login do admin dura antes de pedir a senha de novo.
  sessionHoras: 12,

  // ---------------- Onde os rankings ficam salvos ----------------
  // Um JSON commitado numa branch separada do proprio repositorio.
  // O token precisa ter permissao de escrita em "Contents" nesse repo.
  github: {
    token: process.env.GITHUB_TOKEN || "",
    repo: process.env.GITHUB_REPO || "felipekajati3-commits/mix-dashboard",
    branch: process.env.GITHUB_BRANCH || "data",
    arquivo: process.env.GITHUB_ARQUIVO || "rankings.json",
  },

  // ---------------- Pesos do sorteio ----------------
  // Quanto cada nivel "vale" na hora de equilibrar os times. Rank 1 e
  // o melhor jogador, rank 5 o mais fraco. O sorteio monta os times
  // buscando a menor diferenca possivel entre a soma dos dois lados.
  pesosPorTier: { 1: 5, 2: 4, 3: 3, 4: 2, 5: 1 },
};
