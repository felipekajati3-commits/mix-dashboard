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

// Desenha uma lista de jogadores no estilo do ranking dentro de um container
// qualquer. Usada tanto pelo ranking ao vivo quanto pelas temporadas
// arquivadas (que são só uma "foto" congelada, sem hover com stats atuais).
function renderizarListaRanking(jogadores, container, { comTooltip = true } = {}) {
  const maxPts = Math.max(...jogadores.map((j) => j.points), 1);

  container.innerHTML = jogadores
    .map((j, i) => {
      const pos = i + 1;
      const pct = Math.max(4, (j.points / maxPts) * 100);
      const hsPct = j.hs_pct ?? (j.kills > 0 ? Math.round((j.headshots / j.kills) * 100) : 0);
      return `
        <div class="rank-row pos-${pos}" data-steamid="${j.steam_id}" tabindex="0">
          <div class="rank-pos">${String(pos).padStart(2, "0")}</div>
          ${avatarHtml(j)}
          <div class="rank-name-wrap">
            <div class="rank-name">${escapeHtml(j.name || "Jogador")}</div>
            <div class="rank-stats-line">Kills: ${j.kills ?? 0} &nbsp; Deaths: ${j.deaths ?? 0} &nbsp; HS: ${hsPct}%</div>
            <div class="rank-bar-track"><div class="rank-bar-fill" style="width:${pct}%"></div></div>
          </div>
          <div class="rank-tag">${escapeHtml(j.rank || "")}</div>
          <div class="rank-points">${j.points} pts</div>
        </div>
      `;
    })
    .join("");

  if (!comTooltip) return;

  container.querySelectorAll(".rank-row").forEach((row) => {
    row.addEventListener("mouseenter", () => {
      clearTimeout(tooltipTimeout);
      mostrarTooltipJogador(row.dataset.steamid, row.getBoundingClientRect());
    });
    row.addEventListener("mouseleave", () => {
      tooltipTimeout = setTimeout(fecharModal, 120);
    });
    row.addEventListener("focus", () => {
      mostrarTooltipJogador(row.dataset.steamid, row.getBoundingClientRect());
    });
    row.addEventListener("blur", fecharModal);
  });
}

async function carregarRanking() {
  const container = document.getElementById("leaderboard");
  try {
    const res = await fetch("/api/leaderboard");
    const jogadores = await res.json();

    if (!jogadores.length) {
      container.innerHTML = `<div class="loading">Nenhum jogador registrado ainda.</div>`;
      return;
    }

    renderizarListaRanking(jogadores, container, { comTooltip: true });
  } catch (err) {
    container.innerHTML = `<div class="loading">Erro ao carregar o ranking.</div>`;
  }
}

// ---------- Temporadas passadas (arquivo estático, não vem do banco) ----------
// Os dados ficam num arquivo fixo (public/data/temporadas.json) — pra
// arquivar uma temporada nova, é só editar esse arquivo e subir pro
// GitHub de novo, sem precisar mexer no banco de dados.

let temporadasCache = null;

async function carregarTemporadas() {
  const selectWrap = document.getElementById("season-select-wrap");
  const selectEl = document.getElementById("season-select");
  const container = document.getElementById("season-leaderboard");

  try {
    const res = await fetch("data/temporadas.json");
    if (!res.ok) throw new Error("Arquivo não encontrado.");
    temporadasCache = await res.json();

    const chaves = Object.keys(temporadasCache);
    if (!chaves.length) {
      selectWrap.classList.add("hidden");
      container.innerHTML = `<div class="loading">Nenhuma temporada arquivada ainda.</div>`;
      return;
    }

    selectEl.innerHTML = chaves
      .map((k) => `<option value="${k}">${escapeHtml(temporadasCache[k].label || k)}</option>`)
      .join("");
    selectEl.addEventListener("change", () => mostrarTemporada(selectEl.value));

    mostrarTemporada(chaves[0]);
  } catch (err) {
    selectWrap.classList.add("hidden");
    container.innerHTML = `<div class="loading">Nenhuma temporada arquivada ainda.</div>`;
  }
}

function mostrarTemporada(chave) {
  const container = document.getElementById("season-leaderboard");
  const dados = temporadasCache?.[chave];

  if (!dados || !dados.jogadores?.length) {
    container.innerHTML = `<div class="loading">Nenhum jogador nessa temporada.</div>`;
    return;
  }

  renderizarListaRanking(dados.jogadores, container, { comTooltip: false });
}

carregarTemporadas();



function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Monta o <img> do avatar da Steam, ou um círculo com a inicial do nome
// quando não tiver foto (ex: Steam API fora do ar, perfil privado).
function avatarHtml(jogador) {
  if (jogador.avatar_url) {
    return `<img class="avatar-img" src="${jogador.avatar_url}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'avatar-fallback',textContent:'${(jogador.name || "?").charAt(0).toUpperCase()}'}))" />`;
  }
  const inicial = (jogador.name || "?").charAt(0).toUpperCase();
  return `<div class="avatar-fallback">${escapeHtml(inicial)}</div>`;
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
          ${avatarHtml(j)}
          <span class="player-name">${escapeHtml(j.name)}</span>
          <span class="player-pts">${j.points} pts</span>
        </label>
      `;
    })
    .join("");

  pickerEl.querySelectorAll(".player-row").forEach((row) => {
    const checkbox = row.querySelector("input");
    // Escuta "change" do checkbox (dispara uma única vez por interação real,
    // seja clicando no checkbox ou em qualquer ponto da linha) em vez de
    // "click" na linha inteira — isso evita o bug de clique duplicado que
    // deixava a borda azul e o checkbox dessincronizados.
    checkbox.addEventListener("change", () => {
      const id = row.dataset.id;
      const jogador = todosJogadores.find((j) => j.steam_id === id);
      if (checkbox.checked) {
        selecionados.set(id, jogador);
      } else {
        selecionados.delete(id);
      }
      row.classList.toggle("selected", checkbox.checked);
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

// ---------- Botão "Novo sorteio" ----------
// Some com o resultado atual e desmarca todo mundo, sem precisar recarregar
// a página, pra já deixar pronto pra selecionar os jogadores do próximo sorteio.

const btnNovoSorteio = document.getElementById("btn-novo-sorteio");

btnNovoSorteio.addEventListener("click", () => {
  teamsResultEl.classList.add("hidden");
  selecionados.clear();
  renderizarPicker();
  atualizarContagem();
  msgEl.textContent = "";
  document.getElementById("player-picker").scrollIntoView({ behavior: "smooth", block: "start" });
});

// ---------- Sorteio ao vivo (todo mundo vê, mesmo quem não clicou) ----------

const liveEl = document.getElementById("sorteio-live");
const roletaNomeEl = document.getElementById("roleta-nome");
const socket = io();

socket.on("online:count", (n) => {
  if (onlineCountEl) onlineCountEl.textContent = n;
});

let roletaInterval = null;
const resultadoPartidaEl = document.getElementById("resultado-partida");

// Chega quando o MatchZy avisa que a partida terminou (webhook configurado
// no servidor de CS2). Mostra um banner dentro do painel de times dizendo
// quem ganhou, sem precisar dar F5 na página.
socket.on("partida:resultado", (resultado) => {
  if (!resultadoPartidaEl) return;

  if (!resultado.vencedor) {
    resultadoPartidaEl.className = "resultado-partida empate";
    resultadoPartidaEl.textContent = `Empate — ${resultado.placarA ?? "?"} x ${resultado.placarB ?? "?"}`;
  } else {
    const nomeTime = resultado.vencedor === "A" ? "Time A" : "Time B";
    const classeTime = resultado.vencedor === "A" ? "ct" : "t";
    resultadoPartidaEl.className = `resultado-partida ${classeTime}`;
    resultadoPartidaEl.textContent = `🏆 ${nomeTime} venceu — ${resultado.placarA ?? "?"} x ${resultado.placarB ?? "?"}`;
  }

  resultadoPartidaEl.classList.remove("hidden");
});

socket.on("sorteio:iniciado", ({ jogadores }) => {
  msgEl.textContent = "";
  teamsResultEl.classList.add("hidden");
  liveEl.classList.remove("hidden");
  btnSortear.disabled = true;
  btnSortear.textContent = "Sorteando…";

  // Um sorteio novo começou, então o resultado da partida anterior (se tinha
  // algum sendo mostrado) não faz mais sentido nessa tela.
  if (resultadoPartidaEl) {
    resultadoPartidaEl.classList.add("hidden");
    resultadoPartidaEl.innerHTML = "";
  }

  // Fica trocando o nome exibido rapidamente, tipo caça-níquel, enquanto
  // o servidor calcula o resultado — só efeito visual, não influencia o sorteio.
  const nomes = (jogadores || []).map((j) => j.name).filter(Boolean);
  if (nomes.length && roletaNomeEl) {
    let i = 0;
    clearInterval(roletaInterval);
    roletaInterval = setInterval(() => {
      roletaNomeEl.textContent = nomes[i % nomes.length];
      i++;
    }, 90);
  }
});

socket.on("sorteio:resultado", ({ timeA, timeB, somaA, somaB }) => {
  clearInterval(roletaInterval);
  liveEl.classList.add("hidden");
  renderizarTimes(timeA, timeB, somaA, somaB);
  btnSortear.textContent = "Sortear times";
  btnSortear.disabled = selecionados.size < 2;
  // O registro no histórico é salvo pelo servidor logo depois de emitir
  // o resultado, então dá uma folga curta antes de recarregar a lista.
  setTimeout(carregarHistoricoSorteios, 500);
});

// ---------- Sorteio de mapa ----------

const MAPAS = [
  { id: "mirage", name: "Mirage", img: "https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/de_mirage.png" },
  { id: "inferno", name: "Inferno", img: "https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/de_inferno.png" },
  { id: "dust2", name: "Dust 2", img: "https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/de_dust2.png" },
  { id: "nuke", name: "Nuke", img: "https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/de_nuke.png" },
  { id: "overpass", name: "Overpass", img: "https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/de_overpass.png" },
  { id: "vertigo", name: "Vertigo", img: "https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/de_vertigo.png" },
  { id: "ancient", name: "Ancient", img: "https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/de_ancient.png" },
  { id: "anubis", name: "Anubis", img: "https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/de_anubis.png" },
  { id: "train", name: "Train", img: "https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/de_train.png" },
  { id: "cache", name: "Cache", img: "https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/de_cache.png" },
  { id: "cobblestone", name: "Cobblestone", img: "https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/de_cbble.png" },
];

const mapPickerEl = document.getElementById("map-picker");
const mapSelectedCountEl = document.getElementById("map-selected-count");
const btnSortearMapa = document.getElementById("btn-sortear-mapa");
const mapaMsgEl = document.getElementById("mapa-msg");
const mapaLiveEl = document.getElementById("mapa-live");
const mapResultEl = document.getElementById("map-result");
const mapResultNameEl = document.getElementById("map-result-name");

const mapaSelecionados = new Set(MAPAS.map((m) => m.id));

function renderizarMapPicker() {
  mapPickerEl.innerHTML = MAPAS.map((m) => {
    const marcado = mapaSelecionados.has(m.id);
    return `
      <div class="map-tile ${marcado ? "selected" : ""}" data-id="${m.id}" style="background-image:url('${m.img}')" role="button" tabindex="0" aria-pressed="${marcado}">
        <div class="map-tile-check">✓</div>
        <span class="map-tile-name">${escapeHtml(m.name)}</span>
      </div>
    `;
  }).join("");

  mapPickerEl.querySelectorAll(".map-tile").forEach((tile) => {
    const alternar = () => {
      const id = tile.dataset.id;
      const marcado = mapaSelecionados.has(id);
      if (marcado) {
        mapaSelecionados.delete(id);
      } else {
        mapaSelecionados.add(id);
      }
      tile.classList.toggle("selected", !marcado);
      tile.setAttribute("aria-pressed", String(!marcado));
      atualizarContagemMapa();
    };
    tile.addEventListener("click", alternar);
    tile.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        alternar();
      }
    });
  });
}

function atualizarContagemMapa() {
  const n = mapaSelecionados.size;
  mapSelectedCountEl.textContent = `${n} selecionado${n === 1 ? "" : "s"}`;
  btnSortearMapa.disabled = n < 1;
}

renderizarMapPicker();
atualizarContagemMapa();

btnSortearMapa.addEventListener("click", async () => {
  mapaMsgEl.textContent = "";
  btnSortearMapa.disabled = true;
  btnSortearMapa.textContent = "Sorteando…";

  try {
    const mapas = Array.from(mapaSelecionados);
    const res = await fetch("/api/draft-mapa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapas }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Erro ao sortear o mapa.");
    }
    // O resultado chega pelo socket, igual no sorteio de times.
  } catch (err) {
    mapaMsgEl.textContent = err.message;
    btnSortearMapa.disabled = mapaSelecionados.size < 1;
    btnSortearMapa.textContent = "Sortear mapa";
  }
});

socket.on("mapa:iniciado", () => {
  mapaMsgEl.textContent = "";
  mapResultEl.classList.add("hidden");
  mapaLiveEl.classList.remove("hidden");
  btnSortearMapa.disabled = true;
  btnSortearMapa.textContent = "Sorteando…";
});

socket.on("mapa:resultado", ({ mapaId }) => {
  const mapa = MAPAS.find((m) => m.id === mapaId);
  mapaLiveEl.classList.add("hidden");
  mapResultNameEl.textContent = mapa ? mapa.name : mapaId;
  mapResultEl.style.backgroundImage = mapa ? `url('${mapa.img}')` : "none";
  mapResultEl.classList.remove("hidden");
  btnSortearMapa.textContent = "Sortear mapa";
  btnSortearMapa.disabled = mapaSelecionados.size < 1;
});

function renderizarTimes(timeA, timeB, somaA, somaB) {
  document.getElementById("team-a-total").textContent = `${somaA} pts`;
  document.getElementById("team-b-total").textContent = `${somaB} pts`;

  document.getElementById("team-a-list").innerHTML = timeA
    .map((j) => `<li>${avatarHtml(j)}<span class="team-player-name">${escapeHtml(j.name)}</span> <span class="pts">${j.points}</span></li>`)
    .join("");

  document.getElementById("team-b-list").innerHTML = timeB
    .map((j) => `<li>${avatarHtml(j)}<span class="team-player-name">${escapeHtml(j.name)}</span> <span class="pts">${j.points}</span></li>`)
    .join("");

  teamsResultEl.classList.remove("hidden");
}

// ---------- Tooltip de perfil do jogador (aparece ao passar o mouse) ----------

const modalEl = document.getElementById("player-modal");
const modalContentEl = document.getElementById("modal-content");
let tooltipTimeout = null;
let ultimoRectAncora = null; // linha (rect) que abriu o tooltip, pra poder reposicionar depois
const perfilCache = new Map(); // steam_id -> dados do perfil já buscados

// Mantém o tooltip aberto se o mouse entrar nele (útil quando o conteúdo
// é grande e precisa rolar), e fecha se o mouse sair dele também.
modalEl.addEventListener("mouseenter", () => clearTimeout(tooltipTimeout));
modalEl.addEventListener("mouseleave", () => {
  tooltipTimeout = setTimeout(fecharModal, 120);
});

async function mostrarTooltipJogador(steamId, rect) {
  if (!steamId) return;

  ultimoRectAncora = rect;
  posicionarTooltip(rect);
  modalEl.classList.remove("hidden");

  // Se já buscamos esse jogador antes nessa visita, mostra na hora
  // sem precisar esperar o servidor de novo.
  if (perfilCache.has(steamId)) {
    renderizarPerfilJogador(perfilCache.get(steamId));
    return;
  }

  modalContentEl.innerHTML = `<div class="loading">Carregando…</div>`;

  try {
    const res = await fetch(`/api/player/${encodeURIComponent(steamId)}`);
    if (!res.ok) throw new Error("Jogador não encontrado.");
    const j = await res.json();
    perfilCache.set(steamId, j);
    renderizarPerfilJogador(j);
  } catch (err) {
    modalContentEl.innerHTML = `<div class="loading">Erro ao carregar perfil.</div>`;
  }
}

// Posiciona o tooltip do lado (ou embaixo) da linha que disparou o hover,
// sempre tentando manter ele dentro da tela. Quando já sabemos a altura
// real do conteúdo (depois de renderizado), usamos ela em vez de um
// palpite — assim o tooltip nunca fica cortado embaixo da tela.
function posicionarTooltip(rect, alturaReal) {
  const largura = 320;
  const margem = 12;
  const alturaMax = window.innerHeight - margem * 2;
  const alturaEstimada = Math.min(alturaReal || 380, alturaMax);

  let left = rect.right + margem;
  if (left + largura > window.innerWidth - margem) {
    left = rect.left - largura - margem;
  }
  if (left < margem) {
    left = Math.max(margem, Math.min(rect.left, window.innerWidth - largura - margem));
  }

  let top = rect.top;
  if (top + alturaEstimada > window.innerHeight - margem) {
    top = Math.max(margem, window.innerHeight - alturaEstimada - margem);
  }

  modalEl.style.left = `${left}px`;
  modalEl.style.top = `${top}px`;
}

function renderizarPerfilJogador(j) {
  const totalJogos = (j.game_win || 0) + (j.game_lose || 0);

  const stats = [
    { label: "Pontos", value: j.points },
    { label: "Patente", value: j.rank || "—" },
    { label: "Kills", value: j.kills },
    { label: "Deaths", value: j.deaths },
    { label: "Assistências", value: j.assists },
    { label: "K/D", value: j.kd },
    { label: "Headshots", value: j.headshots },
    { label: "HS %", value: `${j.hs_pct}%` },
    { label: "Precisão", value: `${j.accuracy}%` },
    { label: "MVPs", value: j.mvp },
    { label: "Vitórias", value: j.game_win },
    { label: "Derrotas", value: j.game_lose },
    { label: "Taxa de vitória", value: totalJogos > 0 ? `${j.win_rate}%` : "—" },
    { label: "Rounds vencidos", value: j.round_win },
    { label: "Bombas plantadas", value: j.bomb_planted },
    { label: "Bombas defusadas", value: j.bomb_defused },
  ];

  modalContentEl.innerHTML = `
    <div class="modal-profile-head">
      ${avatarHtml(j)}
      <div>
        <div class="modal-profile-name">${escapeHtml(j.name || "Jogador")}</div>
        <div class="modal-profile-rank">${escapeHtml(j.rank || "")}</div>
      </div>
    </div>
    <div class="modal-stats-grid">
      ${stats
        .map(
          (s) => `
        <div class="modal-stat">
          <span class="modal-stat-label">${escapeHtml(s.label)}</span>
          <span class="modal-stat-value">${s.value}</span>
        </div>
      `
        )
        .join("")}
    </div>
  `;

  // O número de estatísticas mostradas pode variar, então só depois de
  // desenhar o conteúdo é que sabemos a altura real — reposiciona com
  // base nela pra garantir que nada fique cortado fora da tela.
  if (ultimoRectAncora) {
    requestAnimationFrame(() => {
      posicionarTooltip(ultimoRectAncora, modalEl.offsetHeight);
    });
  }
}

function fecharModal() {
  modalEl.classList.add("hidden");
}

// ---------- Contador de online (fixo no header) ----------

const onlineCountEl = document.getElementById("online-count");

// ---------- Histórico de sorteios ----------

const historyEl = document.getElementById("draft-history");

// Monta o "selo" de resultado (quem ganhou + placar) pra um item do
// histórico, se essa rodada já tiver um resultado de partida associado
// (chega via webhook do MatchZy quando a série termina).
function renderizarResultadoHistorico(resultado) {
  if (!resultado) return "";

  if (!resultado.vencedor) {
    return `<div class="history-item-resultado empate">Empate ${resultado.placarA ?? "?"} x ${resultado.placarB ?? "?"}</div>`;
  }

  const nomeTime = resultado.vencedor === "A" ? "Time A" : "Time B";
  const classeTime = resultado.vencedor === "A" ? "ct" : "t";
  return `
    <div class="history-item-resultado ${classeTime}">
      🏆 ${nomeTime} venceu — ${resultado.placarA ?? "?"} x ${resultado.placarB ?? "?"}
    </div>
  `;
}

async function carregarHistoricoSorteios() {
  if (!historyEl) return;
  try {
    const res = await fetch("/api/draft-history");
    const historico = await res.json();

    if (!historico.length) {
      historyEl.innerHTML = `<div class="loading">Nenhum sorteio registrado ainda.</div>`;
      return;
    }

    historyEl.innerHTML = historico
      .map((h) => {
        const data = new Date(h.criado_em);
        const dataFmt = data.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        const nomesA = h.timeA.map((j) => escapeHtml(j.name)).join(", ");
        const nomesB = h.timeB.map((j) => escapeHtml(j.name)).join(", ");
        return `
          <div class="history-item">
            <div class="history-item-date">${dataFmt}</div>
            <div class="history-item-teams">
              <div class="history-item-team"><span class="history-team-label">Time A (${h.somaA} pts):</span> ${nomesA}</div>
              <div class="history-item-team"><span class="history-team-label">Time B (${h.somaB} pts):</span> ${nomesB}</div>
            </div>
            ${renderizarResultadoHistorico(h.resultado)}
          </div>
        `;
      })
      .join("");
  } catch (err) {
    historyEl.innerHTML = `<div class="loading">Erro ao carregar histórico.</div>`;
  }
}

carregarHistoricoSorteios();

carregarRanking();
