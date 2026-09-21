// ---------- Tabs ----------

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");

    // Ranking e Sorteio usam a mesma lista. Ao voltar pra uma delas,
    // busca de novo em silêncio, pra pegar mudanças que o admin salvou
    // enquanto a página estava aberta (sem perder o que já foi marcado).
    if (btn.dataset.tab === "ranking" || btn.dataset.tab === "sorteio") {
      carregarJogadores({ silencioso: true });
    }
  });
});

// ---------- Utilitários ----------

// Escapa também aspas, porque os nomes são usados dentro de atributos
// (title, aria-label…) além de texto normal.
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// Chamado pelo onerror do <img> do avatar: troca a foto quebrada por um
// círculo com a inicial (guardada em data-inicial, sem montar JS em string).
function avatarFallback(img) {
  const div = document.createElement("div");
  div.className = "avatar-fallback";
  div.textContent = img.dataset.inicial || "?";
  img.replaceWith(div);
}

// Monta o <img> do avatar da Steam, ou um círculo com a inicial do nome
// quando não tiver foto (ex: vaga personalizada, perfil privado).
function avatarHtml(jogador) {
  const inicial = escapeHtml((jogador.name || "?").trim().charAt(0).toUpperCase() || "?");
  if (jogador.avatar_url) {
    return `<img class="avatar-img" src="${escapeHtml(jogador.avatar_url)}" alt="" loading="lazy" data-inicial="${inicial}" onerror="avatarFallback(this)" />`;
  }
  return `<div class="avatar-fallback">${inicial}</div>`;
}

// ---------- Lista de jogadores (base do Ranking e do Sorteio) ----------
// Os dois vêm dos rankings manuais definidos em /admin.html (níveis 1 a 5).
// O K4-System não é mais usado.

const TIERS = [1, 2, 3, 4, 5];
const ICONE_TIER = { 1: "🔥", 2: "⚡", 3: "🎯", 4: "🖌️", 5: "💀" };

// Vagas de preenchimento ("Complete 1", "Complete 2"…) existem só pra
// completar o sorteio. Não são jogadores de verdade, então não entram
// na aba Ranking.
const VAGA_PLACEHOLDER = /^complete\s*\d*$/i;

let todosJogadores = [];
let filtroNome = "";

const selecionados = new Map(); // id -> jogador
const nomesTemp = new Map(); // id -> nome provisório (só vale nos sorteios)

const rankingGridEl = document.getElementById("ranking-grid");
const btnSortear = document.getElementById("btn-sortear");
const pickerEl = document.getElementById("player-picker");
const searchEl = document.getElementById("player-search");
const selectedCountEl = document.getElementById("selected-count");
const msgEl = document.getElementById("sorteio-msg");
const teamsResultEl = document.getElementById("teams-result");

// Nome que aparece na tela: o provisório (lápis), se existir, ou o do ranking.
function nomeExibido(j) {
  return (nomesTemp.get(j.id) || j.name || "").trim();
}

// Monta as 5 colunas (uma por nível). Cada tela passa a sua função pra
// desenhar cada linha, e o resto (cabeçalho, contagem, vazio) é igual.
function colunasPorTier(jogadores, renderLinha, textoVazio) {
  return TIERS.map((tier) => {
    const doTier = jogadores.filter((j) => j.tier === tier);
    const linhas = doTier.length
      ? doTier.map(renderLinha).join("")
      : `<div class="picker-vazio">${textoVazio}</div>`;
    return `
      <div class="picker-grupo" data-tier="${tier}">
        <div class="picker-grupo-head">
          <span class="picker-grupo-icon">${ICONE_TIER[tier]}</span>
          RANK ${tier}
          <span class="picker-grupo-qtd">${doTier.length}</span>
        </div>
        ${linhas}
      </div>`;
  }).join("");
}

async function carregarJogadores({ silencioso = false } = {}) {
  if (!silencioso) {
    pickerEl.innerHTML = `<div class="loading">Carregando jogadores…</div>`;
    rankingGridEl.innerHTML = `<div class="loading">Carregando ranking…</div>`;
  }
  try {
    const res = await fetch("/api/rankings", { cache: "no-store" });
    if (!res.ok) throw new Error("Falha ao carregar.");
    const data = await res.json();
    todosJogadores = data.jogadores || [];

    // Quem saiu do ranking não pode continuar marcado nem com nome provisório.
    const idsAtuais = new Set(todosJogadores.map((j) => j.id));
    for (const id of [...selecionados.keys()]) if (!idsAtuais.has(id)) selecionados.delete(id);
    for (const id of [...nomesTemp.keys()]) if (!idsAtuais.has(id)) nomesTemp.delete(id);

    renderizarRanking();
    renderizarPicker();
    atualizarContagem();
  } catch (err) {
    if (silencioso) return; // mantém o que já estava na tela
    pickerEl.innerHTML = `<div class="loading">Erro ao carregar jogadores.</div>`;
    rankingGridEl.innerHTML = `<div class="loading">Erro ao carregar o ranking.</div>`;
  }
}

// ---------- Ranking (com setas de subiu / desceu) ----------

// Compara o nível atual com o que o jogador tinha antes da última mudança.
// Nível MENOR = mais forte, então ir de 3 pra 2 é SUBIR.
function movimentoDe(j) {
  const antes = Number(j.tier_anterior);
  if (!antes || antes === j.tier) {
    return { classe: "same", simbolo: "–", titulo: "Manteve o nível" };
  }
  const data = j.movido_em
    ? ` em ${new Date(j.movido_em).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`
    : "";
  if (j.tier < antes) {
    return { classe: "up", simbolo: "▲", titulo: `Subiu do Rank ${antes} para o Rank ${j.tier}${data}` };
  }
  return { classe: "down", simbolo: "▼", titulo: `Desceu do Rank ${antes} para o Rank ${j.tier}${data}` };
}

function linhaRanking(j) {
  const mov = movimentoDe(j);
  const nome = escapeHtml(j.name);
  return `
    <div class="ranking-row">
      ${avatarHtml(j)}
      <span class="player-name" title="${nome}">${nome}</span>
      <span class="rank-move ${mov.classe}" title="${escapeHtml(mov.titulo)}" aria-label="${escapeHtml(mov.titulo)}">${mov.simbolo}</span>
    </div>`;
}

function renderizarRanking() {
  const reais = todosJogadores.filter(
    (j) => j.name && j.name.trim() && !VAGA_PLACEHOLDER.test(j.name.trim())
  );

  if (!reais.length) {
    rankingGridEl.innerHTML = `<div class="loading">Nenhum jogador cadastrado ainda.</div>`;
    return;
  }

  rankingGridEl.innerHTML = colunasPorTier(reais, linhaRanking, "Ninguém nesse nível ainda.");
}

// ---------- Sorteio (seleção manual de jogadores) ----------

const ICONE_LAPIS = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;

function linhaPicker(j) {
  const nome = nomeExibido(j);
  const marcado = selecionados.has(j.id);
  const vazio = !nome;
  const ehVaga = j.tipo === "vaga";
  const renomeado = nomesTemp.has(j.id);
  const nomeSeguro = escapeHtml(vazio ? "(vaga vazia)" : nome);
  const tituloNome = renomeado ? `${nome} (original: ${j.name || "vazio"})` : nome;

  // O lápis só aparece nas vagas personalizadas ("Complete 1"…): elas
  // existem justamente pra receber, de vez em quando, um jogador que
  // não está no ranking. A troca vale só pros sorteios, não vai pro ranking.
  const lapis = ehVaga
    ? `<button type="button" class="btn-lapis ${renomeado ? "ativo" : ""}"
         title="Editar nome (vale só para o sorteio)" aria-label="Editar nome de ${nomeSeguro}">${ICONE_LAPIS}</button>`
    : "";

  return `
    <label class="player-row ${marcado ? "selected" : ""} ${vazio ? "vaga-vazia" : ""}" data-id="${escapeHtml(j.id)}">
      <input type="checkbox" ${marcado ? "checked" : ""} ${vazio ? "disabled" : ""} />
      ${avatarHtml({ ...j, name: nome })}
      <span class="player-name" title="${escapeHtml(tituloNome)}">${nomeSeguro}</span>
      ${lapis}
    </label>`;
}

function renderizarPicker() {
  if (todosJogadores.length === 0) {
    pickerEl.innerHTML = `<div class="loading">Nenhum jogador cadastrado ainda. Cadastre os rankings em <a href="/admin.html">/admin.html</a>.</div>`;
    return;
  }

  // Filtro é local: a lista inteira já está na memória, não precisa
  // voltar no servidor a cada letra digitada.
  const termo = filtroNome.toLowerCase();
  const visiveis = termo
    ? todosJogadores.filter((j) => nomeExibido(j).toLowerCase().includes(termo))
    : todosJogadores;

  if (visiveis.length === 0) {
    pickerEl.innerHTML = `<div class="loading">Nenhum jogador com esse nome.</div>`;
    return;
  }

  pickerEl.innerHTML = colunasPorTier(visiveis, linhaPicker, "Ninguém nesse nível ainda.");

  pickerEl.querySelectorAll(".player-row").forEach((row) => {
    const checkbox = row.querySelector("input[type=checkbox]");
    // Escuta "change" do checkbox (dispara uma única vez por interação real,
    // seja clicando no checkbox ou em qualquer ponto da linha) em vez de
    // "click" na linha inteira — isso evita o bug de clique duplicado que
    // deixava a borda azul e o checkbox dessincronizados.
    checkbox.addEventListener("change", () => {
      const id = row.dataset.id;
      const jogador = todosJogadores.find((j) => j.id === id);
      if (checkbox.checked) {
        selecionados.set(id, jogador);
      } else {
        selecionados.delete(id);
      }
      row.classList.toggle("selected", checkbox.checked);
      atualizarContagem();
    });

    row.querySelector(".btn-lapis")?.addEventListener("click", (e) => {
      // Está dentro de um <label>: sem isso o clique também marcaria o checkbox.
      e.preventDefault();
      e.stopPropagation();
      iniciarEdicaoNome(row);
    });
  });
}

// Troca o nome da linha por um campo de texto. Enter ou clicar fora
// confirma; Esc cancela; deixar vazio volta pro nome original.
function iniciarEdicaoNome(row) {
  const id = row.dataset.id;
  const jogador = todosJogadores.find((j) => j.id === id);
  const nomeEl = row.querySelector(".player-name");
  if (!jogador || !nomeEl) return;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "nome-temp-input";
  input.maxLength = 40;
  input.value = nomesTemp.get(id) ?? jogador.name ?? "";
  input.placeholder = jogador.name || "Nome do jogador…";
  input.setAttribute("aria-label", "Nome provisório do jogador");
  nomeEl.replaceWith(input);
  input.focus();
  input.select();

  let encerrado = false;
  const concluir = (confirmar) => {
    if (encerrado) return; // Enter + blur chegam quase juntos
    encerrado = true;

    if (confirmar) {
      const novo = input.value.trim();
      if (novo && novo !== jogador.name) nomesTemp.set(id, novo);
      else nomesTemp.delete(id);
    }
    // Vaga que ficou sem nome não pode continuar marcada pro sorteio.
    if (!nomeExibido(jogador)) selecionados.delete(id);

    renderizarPicker();
    atualizarContagem();
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      concluir(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      concluir(false);
    }
  });
  input.addEventListener("blur", () => concluir(true));
  input.addEventListener("click", (e) => e.stopPropagation());
}

function atualizarContagem() {
  const n = selecionados.size;
  const total = todosJogadores.filter((j) => nomeExibido(j)).length;
  selectedCountEl.textContent = `${n} / ${total}`;
  btnSortear.disabled = n < 2;
}

let debounceTimer;
searchEl.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    filtroNome = searchEl.value.trim();
    renderizarPicker();
  }, 150);
});

btnSortear.addEventListener("click", async () => {
  msgEl.textContent = "";
  btnSortear.disabled = true;
  btnSortear.textContent = "Sorteando…";

  try {
    // Manda os ids de quem foi marcado. O nível de cada um quem decide é o
    // servidor. Os nomes provisórios (lápis) vão junto, só dos marcados; o
    // servidor só aceita eles em vagas personalizadas.
    const ids = Array.from(selecionados.keys());
    const nomes = {};
    for (const id of ids) if (nomesTemp.has(id)) nomes[id] = nomesTemp.get(id);

    const res = await fetch("/api/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, nomes }),
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

// ---------- Botão "Limpar" ----------
// Desmarca todo mundo sem esconder o resultado nem recarregar a lista.
// Os nomes provisórios continuam (é só desmarcar).

const btnLimpar = document.getElementById("btn-limpar");
btnLimpar.addEventListener("click", () => {
  selecionados.clear();
  renderizarPicker();
  atualizarContagem();
});

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
  document.getElementById("team-a-total").textContent = `força ${somaA}`;
  document.getElementById("team-b-total").textContent = `força ${somaB}`;

  document.getElementById("team-a-list").innerHTML = timeA
    .map((j) => `<li>${avatarHtml(j)}<span class="team-player-name">${escapeHtml(j.name)}</span> <span class="pts tier-badge tier-${j.tier}">R${j.tier}</span></li>`)
    .join("");

  document.getElementById("team-b-list").innerHTML = timeB
    .map((j) => `<li>${avatarHtml(j)}<span class="team-player-name">${escapeHtml(j.name)}</span> <span class="pts tier-badge tier-${j.tier}">R${j.tier}</span></li>`)
    .join("");

  teamsResultEl.classList.remove("hidden");
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

