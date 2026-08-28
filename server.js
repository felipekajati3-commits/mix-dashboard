const express = require("express");
const mysql = require("mysql2/promise");
const config = require("./config");

const app = express();
app.use(express.json());
app.use(express.static("public"));

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 5,
});

// Distribui os jogadores em dois times o mais equilibrado possivel,
// embaralhando empates para o sorteio nao ficar sempre igual.
function sortearTimes(jogadores) {
  const embaralhados = [...jogadores].sort(() => Math.random() - 0.5);
  const ordenados = embaralhados.sort((a, b) => b.points - a.points);

  const timeA = [];
  const timeB = [];
  let somaA = 0;
  let somaB = 0;

  for (const jogador of ordenados) {
    if (somaA <= somaB) {
      timeA.push(jogador);
      somaA += jogador.points;
    } else {
      timeB.push(jogador);
      somaB += jogador.points;
    }
  }

  return { timeA, timeB, somaA, somaB };
}

// ---------------- ROTAS ----------------

app.get("/api/leaderboard", async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT steam_id, name, points, `rank` FROM rank_mix_k4ranks ORDER BY points DESC LIMIT ?",
      [config.leaderboardLimit]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar o ranking." });
  }
});

// Lista de jogadores para o seletor do sorteio (busca opcional por nome).
app.get("/api/players", async (req, res) => {
  try {
    const busca = req.query.q ? `%${req.query.q}%` : "%";
    const [rows] = await pool.query(
      "SELECT steam_id, name, points FROM rank_mix_k4ranks WHERE name LIKE ? ORDER BY points DESC LIMIT 200",
      [busca]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar jogadores." });
  }
});

app.post("/api/draft", async (req, res) => {
  try {
    const jogadores = req.body.jogadores;

    if (!Array.isArray(jogadores) || jogadores.length < 2) {
      return res.status(400).json({ error: "Selecione pelo menos 2 jogadores para sortear." });
    }

    const resultado = sortearTimes(jogadores);
    res.json(resultado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao sortear os times." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Mix Dashboard rodando em http://localhost:${PORT}`);
});
