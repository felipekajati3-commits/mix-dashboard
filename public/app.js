// ---------- Tabs ----------

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  });
});

// ---------- Ranking ----------

async function carregarRanking() {
  const container = document.getElementById("leaderboard");
  try {
    const res = await fetch("/api/leaderboard");
    const jogadores = await res.json();

    if (!jogadores.length) {
      container.innerHTML = `<div class="loading">Nenhum jogador registrado ainda.</div>`;
      return;
    }

    const maxPts = Math.max(...jogadores.map((j) => j.points), 1);

    container.innerHTML = jogadores
      .map((j, i) => {
        const pos = i + 1;
        const pct = Math.max(4, (j.points / maxPts) * 100);
        return `
          <div class="rank-row pos-${pos}">
            <div class="rank-pos">${String(pos).padStart(2, "0")}</div>
            <div class="rank-name-wrap">
              <div class="rank-name">${escapeHtml(j.name || "Jogador")}</div>
              <div class="rank-bar-track"><div class="rank-bar-fill" style="width:${pct}%"></div></div>
            </div>
            <div class="rank-tag">${escapeHtml(j.rank || "")}</div>
            <div class="rank-points">${j.points} pts</div>
          </div>
        `;
      })
      .join("");
  } catch (err) {
    container.innerHTML = `<div class="loading">Erro ao carregar o ranking.</div>`;
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Sorteio (seleção manual de jogadores) ----------

let todosJogadores = [];
const selecionados = new Map(); // steam_id -> jogador

const btnSortear = document.getElementById("btn-sortear");
const pickerEl = document.getElementById("player-picker");
const searchEl = document.getElementById("player-search");
const selectedCountEl = document.getElementById("selected-count");
const msgEl = document.getElementById("sorteio-msg");
const teamsResultEl = document.getElementById("teams-result");

async function carregarJogadores(termo = "") {
  pickerEl.innerHTML = `<div class="loading">Carregando jogadores…</div>`;
  try {
    const url = termo ? `/api/players?q=${encodeURIComponent(termo)}` : "/api/players";
    const res = await fetch(url);
    todosJogadores = await res.json();
    renderizarPicker();
  } catch (err) {
    pickerEl.innerHTML = `<div class="loading">Erro ao carregar jogadores.</div>`;
  }
}

function renderizarPicker() {
  if (todosJogadores.length === 0) {
    pickerEl.innerHTML = `<div class="loading">Nenhum jogador encontrado.</div>`;
    return;
  }

  pickerEl.innerHTML = todosJogadores
    .map((j) => {
      const marcado = selecionados.has(j.steam_id);
      return `
        <label class="player-row ${marcado ? "selected" : ""}" data-id="${j.steam_id}">
          <input type="checkbox" ${marcado ? "checked" : ""} />
          <span class="player-name">${escapeHtml(j.name)}</span>
          <span class="player-pts">${j.points} pts</span>
        </label>
      `;
    })
    .join("");

  pickerEl.querySelectorAll(".player-row").forEach((row) => {
    row.addEventListener("click", (e) => {
      e.preventDefault();
      const id = row.dataset.id;
      const jogador = todosJogadores.find((j) => j.steam_id === id);
      if (selecionados.has(id)) {
        selecionados.delete(id);
      } else {
        selecionados.set(id, jogador);
      }
      row.classList.toggle("selected");
      row.querySelector("input").checked = selecionados.has(id);
      atualizarContagem();
    });
  });
}

function atualizarContagem() {
  const n = selecionados.size;
  selectedCountEl.textContent = `${n} selecionado${n === 1 ? "" : "s"}`;
  btnSortear.disabled = n < 2;
}

let debounceTimer;
searchEl.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => carregarJogadores(searchEl.value.trim()), 250);
});

btnSortear.addEventListener("click", async () => {
  msgEl.textContent = "";
  btnSortear.disabled = true;
  btnSortear.textContent = "Sorteando…";

  try {
    const jogadores = Array.from(selecionados.values());
    const res = await fetch("/api/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jogadores }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Erro ao sortear.");
    }
    // A partir daqui, quem mostra o resultado na tela (pra este cliente
    // e pra todos os outros) são os eventos do socket.io, não esse fetch.
  } catch (err) {
    msgEl.textContent = err.message;
    btnSortear.disabled = selecionados.size < 2;
    btnSortear.textContent = "Sortear times";
  }
});

carregarJogadores();

// ---------- Sorteio ao vivo (todo mundo vê, mesmo quem não clicou) ----------

const liveEl = document.getElementById("sorteio-live");
const socket = io();

socket.on("sorteio:iniciado", () => {
  msgEl.textContent = "";
  teamsResultEl.classList.add("hidden");
  liveEl.classList.remove("hidden");
  btnSortear.disabled = true;
  btnSortear.textContent = "Sorteando…";
});

socket.on("sorteio:resultado", ({ timeA, timeB, somaA, somaB }) => {
  liveEl.classList.add("hidden");
  renderizarTimes(timeA, timeB, somaA, somaB);
  btnSortear.textContent = "Sortear times";
  btnSortear.disabled = selecionados.size < 2;
});

function renderizarTimes(timeA, timeB, somaA, somaB) {
  document.getElementById("team-a-total").textContent = `${somaA} pts`;
  document.getElementById("team-b-total").textContent = `${somaB} pts`;

  document.getElementById("team-a-list").innerHTML = timeA
    .map((j) => `<li>${escapeHtml(j.name)} <span class="pts">${j.points}</span></li>`)
    .join("");

  document.getElementById("team-b-list").innerHTML = timeB
    .map((j) => `<li>${escapeHtml(j.name)} <span class="pts">${j.points}</span></li>`)
    .join("");

  teamsResultEl.classList.remove("hidden");
}

carregarRanking();
