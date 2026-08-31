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
  pluginSecret: process.env.PLUGIN_SECRET || "power1999",

  leaderboardLimit: 50,
};
