const express = require("express");
const mysql = require("mysql2/promise");
const http = require("http");
const { Server } = require("socket.io");
const config = require("./config");

const app = express();
app.use(express.json());
app.use(express.static("public"));

// Servidor HTTP "cru" por baixo do Express, necessário pro socket.io
// conseguir se anexar e manter conexões abertas com os clientes.
const server = http.createServer(app);
const io = new Server(server);

io.on("connection", (socket) => {
  // Nada de especial a fazer aqui por enquanto, mas é útil pra debug
  // saber quantas pessoas estão vendo a página em tempo real.
  console.log(`Cliente conectado (${io.engine.clientsCount} online)`);

  socket.on("disconnect", () => {
    console.log(`Cliente saiu (${io.engine.clientsCount} online)`);
  });
});

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

// Impede que dois sorteios rodem ao mesmo tempo (ex: duas pessoas
// clicando "Sortear" quase junto), o que bagunçaria o que todo mundo vê.
let sorteioEmAndamento = false;

app.post("/api/draft", async (req, res) => {
  try {
    if (sorteioEmAndamento) {
      return res.status(409).json({ error: "Já tem um sorteio em andamento. Aguarde terminar." });
    }

    const jogadores = req.body.jogadores;

    if (!Array.isArray(jogadores) || jogadores.length < 2) {
      return res.status(400).json({ error: "Selecione pelo menos 2 jogadores para sortear." });
    }

    sorteioEmAndamento = true;

    // Calcula o resultado UMA VEZ no servidor (nunca no navegador de
    // cada pessoa), pra garantir que todo mundo veja o mesmo time.
    const resultado = sortearTimes(jogadores);

    // Avisa todo mundo conectado que o sorteio começou, pra tela deles
    // mostrar a animação/roleta em vez de aparecer o resultado do nada.
    io.emit("sorteio:iniciado", { jogadores });

    // Segura um pouco antes de revelar o resultado, só pra dar tempo da
    // animação de "sorteando..." rodar na tela de todo mundo.
    setTimeout(() => {
      io.emit("sorteio:resultado", resultado);
      sorteioEmAndamento = false;
    }, 3000);

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    sorteioEmAndamento = false;
    res.status(500).json({ error: "Erro ao sortear os times." });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Mix Dashboard rodando em http://localhost:${PORT}`);
});
