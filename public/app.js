// ---------- Tabs ----------

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");

    // Ranking (K4-System, por pontos) e Sorteio (níveis manuais) têm
    // fontes diferentes agora. Ao voltar pra uma delas, busca de novo em
    // silêncio, pra pegar o que mudou enquanto a página estava aberta
    // (sem perder o que já foi marcado no sorteio).
    if (btn.dataset.tab === "ranking") {
      carregarLeaderboard({ silencioso: true, animar: true });
    } else if (btn.dataset.tab === "sorteio") {
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

// ---------- Ranking (K4-System, por pontos) ----------
// Vem direto de /api/leaderboard (tabela do plugin K4 no servidor).
// Independente da lista manual usada no Sorteio.

const leaderboardEl = document.getElementById("leaderboard");

// ---------- Cores por faixa de pontos (igual ao Premier da Valve) ----------
// Faixas de 5000 em 5000, cada uma com uma cor — o nome/pontos do
// jogador mudam de cor sozinhos ao cruzar cada faixa.
const FAIXAS_PREMIER = [
  { min: 30000, classe: "premier-dourado" },
  { min: 25000, classe: "premier-vermelho" },
  { min: 20000, classe: "premier-rosa" },
  { min: 15000, classe: "premier-roxo" },
  { min: 10000, classe: "premier-azul" },
  { min: 5000, classe: "premier-azul-claro" },
  { min: 0, classe: "premier-cinza" },
];

function faixaPremier(pontos) {
  return (FAIXAS_PREMIER.find((f) => (pontos || 0) >= f.min) || FAIXAS_PREMIER[FAIXAS_PREMIER.length - 1]).classe;
}

// Conta o número de 0 até o valor final (some se o sistema pede "reduzir movimento").
const reduzirMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function contarPontos(el, alvo) {
  if (reduzirMovimento) {
    el.textContent = `${alvo.toLocaleString("pt-BR")} pts`;
    return;
  }
  const duracao = 1100;
  const inicio = performance.now();
  (function passo(agora) {
    const k = Math.min((agora - inicio) / duracao, 1);
    const suave = 1 - Math.pow(1 - k, 3);
    el.textContent = `${Math.round(alvo * suave).toLocaleString("pt-BR")} pts`;
    if (k < 1) requestAnimationFrame(passo);
  })(inicio);
}

// ---------- Ranking: setas de subiu/desceu, estatísticas ao lado do nome e perfil ----------

const FAIXA_INFO = {
  "premier-dourado": { cor: "#d4af37", nome: "Dourado" },
  "premier-vermelho": { cor: "#e5484d", nome: "Vermelho" },
  "premier-rosa": { cor: "#e26bc7", nome: "Rosa" },
  "premier-roxo": { cor: "#9b6bd4", nome: "Roxo" },
  "premier-azul": { cor: "#5b8def", nome: "Azul" },
  "premier-azul-claro": { cor: "#6ec1e4", nome: "Azul claro" },
  "premier-cinza": { cor: "#9aa0a8", nome: "Cinza" },
};

let jogadoresRanking = [];
let movimentosRanking = {}; // steam_id -> diferença de posições (null = sem comparação)

const fixo = (n, casas) => Number(n).toFixed(casas); // ponto como separador decimal (2.52)
const temNum = (v) => v !== null && v !== undefined;

// Guarda no navegador as posições de cada visita pra comparar com a próxima.
// Uma "visita" nova = mais de 30 min desde a última vez que a pessoa abriu o site.
function calcularMovimentos(jogadores) {
  const atual = {};
  jogadores.forEach((j, i) => { atual[j.steam_id] = i + 1; });
  const movs = {};
  let base = null;
  try {
    const salvo = JSON.parse(localStorage.getItem("mix_rank_posicoes") || "null");
    const agora = Date.now();
    if (salvo && salvo.cur) {
      base = agora - salvo.ts > 30 * 60 * 1000 ? salvo.cur : salvo.base || null;
    }
    localStorage.setItem("mix_rank_posicoes", JSON.stringify({ base, cur: atual, ts: agora }));
  } catch {
    base = null; // navegador sem armazenamento: simplesmente sem setas
  }
  jogadores.forEach((j, i) => {
    if (!base) movs[j.steam_id] = null;
    else if (base[j.steam_id] === undefined) movs[j.steam_id] = "novo";
    else movs[j.steam_id] = base[j.steam_id] - (i + 1);
  });
  return movs;
}

function movHtml(mov) {
  if (mov === null || mov === undefined) return "";
  if (mov === "novo") return `<span class="rank-mov novo">NOVO</span>`;
  if (mov > 0) return `<span class="rank-mov up">▲ ${mov}</span>`;
  if (mov < 0) return `<span class="rank-mov down">▼ ${-mov}</span>`;
  return `<span class="rank-mov eq">–</span>`;
}

function kdDe(r) {
  if (!r || !temNum(r.k) || !temNum(r.m)) return null;
  return r.k / Math.max(r.m, 1);
}
function hsPercDe(r) {
  if (!r || !temNum(r.hs) || !temNum(r.k) || r.k <= 0) return null;
  return Math.min((r.hs / r.k) * 100, 100);
}

function statsLinhaHtml(r) {
  if (!r) return "";
  const partes = [];
  if (temNum(r.v)) partes.push(`<span><i>V</i><b>${r.v}</b></span>`);
  if (temNum(r.d)) partes.push(`<span><i>D</i><b>${r.d}</b></span>`);
  const kd = kdDe(r);
  if (kd !== null) partes.push(`<span><i>K/D</i><b>${fixo(kd, 2)}</b></span>`);
  const hs = hsPercDe(r);
  if (hs !== null) partes.push(`<span><i>HS</i><b>${fixo(hs, 0)}%</b></span>`);
  return partes.length ? `<div class="rank-st">${partes.join("")}</div>` : "";
}

const perfilOv = document.getElementById("perfil-ov");
const perfilCard = document.getElementById("perfil-card");

function abrirPerfil(idx) {
  const j = jogadoresRanking[idx];
  if (!j) return;
  const classe = faixaPremier(j.points);
  const info = FAIXA_INFO[classe];
  const r = j.resumo;
  const stats = [];
  if (r) {
    if (temNum(r.k)) stats.push(["Kills", r.k]);
    if (temNum(r.m)) stats.push(["Mortes", r.m]);
    const kd = kdDe(r);
    if (kd !== null) stats.push(["K/D", fixo(kd, 2)]);
    const hs = hsPercDe(r);
    if (hs !== null) stats.push(["% HS", fixo(hs, 1) + "%"]);
    // Partidas jogadas = vitórias + derrotas (dados do K4).
    if (temNum(r.v) && temNum(r.d)) stats.push(["Partidas", r.v + r.d]);
    if (temNum(r.v)) stats.push(["Vitórias", r.v]);
    if (temNum(r.d)) stats.push(["Derrotas", r.d]);
    if (temNum(r.v) && temNum(r.d) && r.v + r.d > 0) stats.push(["% Vitórias", fixo((r.v / (r.v + r.d)) * 100, 0) + "%"]);
  }
  const mov = movimentosRanking[j.steam_id];
  let nota = "";
  if (mov === "novo") nota = "Novo no ranking desde a última visita";
  else if (mov > 0) nota = `Subiu ${mov} posição(ões) desde a última visita`;
  else if (mov < 0) nota = `Desceu ${-mov} posição(ões) desde a última visita`;
  else if (mov === 0) nota = "Manteve a posição desde a última visita";

  perfilCard.style.setProperty("--c", info.cor);
  perfilCard.innerHTML = `
    <button class="perfil-x" id="perfil-x" aria-label="Fechar">×</button>
    <div class="perfil-top">
      <div class="perfil-avatar">${avatarHtml({ name: j.name, avatar_url: j.avatar_url })}</div>
      <h2>${escapeHtml(j.name || "Jogador")}</h2>
      <div class="perfil-tags"><span class="perfil-tag">#${idx + 1} no ranking</span><span class="perfil-tag">${info.nome}</span></div>
    </div>
    <div class="perfil-pontos"><b>${(j.points ?? 0).toLocaleString("pt-BR")}</b><small>PONTOS</small></div>
    ${stats.length
      ? `<div class="perfil-grid">${stats.map(([rot, val], k) => `<div class="perfil-s" style="--i:${k}"><b>${val}</b><small>${rot}</small></div>`).join("")}</div>`
      : `<div class="perfil-nota">Sem estatísticas detalhadas para este jogador.</div>`}
    ${nota ? `<div class="perfil-nota">${nota}</div>` : ""}`;
  perfilOv.classList.add("on");
  document.getElementById("perfil-x").addEventListener("click", fecharPerfil);
}

function fecharPerfil() { perfilOv.classList.remove("on"); }

leaderboardEl.addEventListener("click", (e) => {
  const nome = e.target.closest(".rank-name");
  if (nome) abrirPerfil(Number(nome.dataset.idx));
});
perfilOv.addEventListener("click", (e) => { if (e.target === perfilOv) fecharPerfil(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") fecharPerfil(); });

async function carregarLeaderboard({ silencioso = false, animar = !silencioso } = {}) {
  if (!silencioso) {
    leaderboardEl.innerHTML = `<div class="loading">Carregando ranking…</div>`;
  }
  try {
    const res = await fetch("/api/leaderboard", { cache: "no-store" });
    if (!res.ok) throw new Error("Falha ao carregar.");
    const jogadores = await res.json();

    if (!jogadores.length) {
      leaderboardEl.innerHTML = `<div class="loading">Nenhum jogador registrado ainda.</div>`;
      return;
    }

    jogadoresRanking = jogadores;
    movimentosRanking = calcularMovimentos(jogadores);

    // Cor do clarão de fundo = faixa do líder.
    leaderboardEl.className = `leaderboard glow-${faixaPremier(jogadores[0].points)}`;

    leaderboardEl.innerHTML = jogadores
      .map((j, i) => {
        const pos = i + 1;
        const nome = escapeHtml(j.name || "Jogador");
        const faixa = faixaPremier(j.points);
        const pontos = j.points ?? 0;
        return `
          <div class="rank-row pos-${pos} ${faixa} ${animar ? "anima" : ""}" style="--i:${i}">
            <div class="rank-posbox">
              <div class="rank-pos">${String(pos).padStart(2, "0")}</div>
              ${movHtml(movimentosRanking[j.steam_id])}
            </div>
            ${avatarHtml({ name: j.name, avatar_url: j.avatar_url })}
            <div class="rank-info">
              <span class="rank-name" data-idx="${i}" title="Ver perfil de ${nome}">${nome}</span>
              ${statsLinhaHtml(j.resumo)}
            </div>
            <div class="rank-points" data-p="${pontos}">${animar ? "0" : pontos.toLocaleString("pt-BR")} pts</div>
          </div>`;
      })
      .join("");

    if (animar) {
      leaderboardEl.querySelectorAll(".rank-points").forEach((el, i) => {
        setTimeout(() => contarPontos(el, Number(el.dataset.p)), i * 60);
      });
    }
  } catch (err) {
    if (silencioso) return; // mantém o que já estava na tela
    leaderboardEl.innerHTML = `<div class="loading">Erro ao carregar o ranking.</div>`;
  }
}

carregarLeaderboard();


// ---------- Lista de jogadores (base do Sorteio) ----------
// Vem dos rankings manuais definidos em /admin.html (níveis 1 a 5). Só
// alimenta a aba Sorteio agora — a aba Ranking usa o K4-System acima.

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

const btnSortear = document.getElementById("btn-sortear");
const pickerEl = document.getElementById("player-picker");
const searchEl = document.getElementById("player-search");
const selectedCountEl = document.getElementById("selected-count");
const msgEl = document.getElementById("sorteio-msg");
const teamsResultEl = document.getElementById("teams-result");

// ---------- Modo do sorteio: times ou vagas ----------
// As duas opções usam a MESMA seleção de jogadores (Map "selecionados"
// acima); só muda o que acontece ao clicar em sortear e como o
// resultado é mostrado.

let modoSorteio = "times"; // "times" | "vaga"

const modoBtns = document.querySelectorAll(".modo-btn");
const vagaConfigEl = document.getElementById("vaga-config");
const inputVagas = document.getElementById("input-vagas");
const vagaLiveEl = document.getElementById("vaga-live");
const roletaVagaNomeEl = document.getElementById("roleta-vaga-nome");
const vagaResultEl = document.getElementById("vaga-result");
const vagaSorteadosListEl = document.getElementById("vaga-sorteados-list");
const vagaForaListEl = document.getElementById("vaga-fora-list");
const btnNovoSorteioVaga = document.getElementById("btn-novo-sorteio-vaga");

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

    renderizarPicker();
    atualizarContagem();
  } catch (err) {
    if (silencioso) return; // mantém o que já estava na tela
    pickerEl.innerHTML = `<div class="loading">Erro ao carregar jogadores.</div>`;
  }
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

let pickerJaAnimou = false;

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

  // Entrada em cascata só na primeira vez que a lista aparece.
  const animarPicker = !pickerJaAnimou;
  pickerJaAnimou = true;
  pickerEl.classList.toggle("anima", animarPicker);
  if (animarPicker) {
    pickerEl.querySelectorAll(".player-row").forEach((row, i) => row.style.setProperty("--i", Math.min(i, 30)));
  }

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

  if (modoSorteio === "vaga") {
    const vagas = Number(inputVagas.value) || 0;
    btnSortear.disabled = n < 2 || vagas < 1 || vagas >= n;
  } else {
    btnSortear.disabled = n < 2;
  }

  const caixa = selectedCountEl.closest(".selected-count-big");
  if (caixa) {
    caixa.classList.toggle("pronto", !btnSortear.disabled);
    if (selectedCountEl.dataset.ultimo !== String(n)) {
      selectedCountEl.dataset.ultimo = String(n);
      caixa.classList.remove("bump");
      void caixa.offsetWidth;
      caixa.classList.add("bump");
    }
  }
}

// Troca entre "Sortear times" e "Sortear vagas". Some com qualquer
// resultado/animação que estivesse na tela do modo anterior, pra não
// ficar coisa de um modo aparecendo junto com o outro.
modoBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.classList.contains("active")) return;

    modoBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    modoSorteio = btn.dataset.modo;

    vagaConfigEl.classList.toggle("hidden", modoSorteio !== "vaga");
    teamsResultEl.classList.add("hidden");
    vagaResultEl.classList.add("hidden");
    liveEl.classList.add("hidden");
    vagaLiveEl.classList.add("hidden");
    msgEl.textContent = "";
    btnSortear.textContent = modoSorteio === "vaga" ? "Sortear vagas" : "Sortear times";

    atualizarContagem();
  });
});

inputVagas.addEventListener("input", atualizarContagem);

function ajustarVagas(delta) {
  inputVagas.value = Math.max(1, (Number(inputVagas.value) || 1) + delta);
  atualizarContagem();
}
document.getElementById("vagas-menos").addEventListener("click", () => ajustarVagas(-1));
document.getElementById("vagas-mais").addEventListener("click", () => ajustarVagas(1));

let debounceTimer;
searchEl.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    filtroNome = searchEl.value.trim();
    renderizarPicker();
  }, 150);
});

btnSortear.addEventListener("click", () => {
  if (modoSorteio === "vaga") sortearVagas();
  else sortearTimes();
});

async function sortearTimes() {
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
}

// Sorteio de vagas: mesma seleção de jogadores do sorteio de times, mas
// em vez de dividir em dois times, sorteia quem fica com as N vagas
// disponíveis (ex: 4 marcados, 2 vagas -> sorteia 2 deles).
async function sortearVagas() {
  msgEl.textContent = "";
  btnSortear.disabled = true;
  btnSortear.textContent = "Sorteando…";

  try {
    const ids = Array.from(selecionados.keys());
    const nomes = {};
    for (const id of ids) if (nomesTemp.has(id)) nomes[id] = nomesTemp.get(id);
    const vagas = Number(inputVagas.value);

    const res = await fetch("/api/draft-vaga", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, nomes, vagas }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Erro ao sortear a vaga.");
    }
    // O resultado chega pelo socket ("vaga:resultado"), igual no sorteio de times.
  } catch (err) {
    msgEl.textContent = err.message;
    atualizarContagem();
    btnSortear.textContent = "Sortear vagas";
  }
}

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
  if (onlineCountEl) {
    const mudou = onlineCountEl.textContent !== String(n);
    onlineCountEl.textContent = n;
    if (mudou) {
      onlineCountEl.classList.remove("bump");
      void onlineCountEl.offsetWidth;
      onlineCountEl.classList.add("bump");
    }
  }
});

let roletaInterval = null;

// Troca o nome rapidamente e vai desacelerando até a hora do resultado.
// Só efeito visual: não influencia o sorteio, que é decidido no servidor.
const giroNomesTimers = new WeakMap();

function pararGiroNomes(el) {
  if (el) clearTimeout(giroNomesTimers.get(el));
}

function girarNomes(el, nomes, duracao = 2800) {
  pararGiroNomes(el);
  const passos = 26;
  const pesos = Array.from({ length: passos }, (_, k) => Math.pow(1.13, k));
  const escala = duracao / pesos.reduce((x, y) => x + y, 0);
  let k = 0;
  const passo = () => {
    el.textContent = nomes[Math.floor(Math.random() * nomes.length)];
    if (++k < passos) giroNomesTimers.set(el, setTimeout(passo, pesos[k - 1] * escala));
  };
  passo();
}
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
  if (nomes.length && roletaNomeEl) girarNomes(roletaNomeEl, nomes, 2800);
});

// ---------- Sorteio de vagas ao vivo ----------

let roletaVagaInterval = null;

socket.on("vaga:iniciado", ({ jogadores }) => {
  msgEl.textContent = "";
  vagaResultEl.classList.add("hidden");
  vagaLiveEl.classList.remove("hidden");
  btnSortear.disabled = true;
  btnSortear.textContent = "Sorteando…";

  const nomes = (jogadores || []).map((j) => j.name).filter(Boolean);
  if (nomes.length && roletaVagaNomeEl) girarNomes(roletaVagaNomeEl, nomes, 2800);
});

socket.on("vaga:resultado", ({ sorteados, restantes }) => {
  clearInterval(roletaVagaInterval);
  pararGiroNomes(roletaVagaNomeEl);
  vagaLiveEl.classList.add("hidden");
  renderizarVagas(sorteados, restantes);
  btnSortear.textContent = "Sortear vagas";
  atualizarContagem();
});

function renderizarVagas(sorteados, restantes) {
  vagaSorteadosListEl.innerHTML = sorteados
    .map((j, i) => `<li class="entra-time" style="--i:${i}">${avatarHtml(j)}<span class="team-player-name">${escapeHtml(j.name)}</span></li>`)
    .join("");
  vagaForaListEl.innerHTML = restantes
    .map((j, i) => `<li class="entra-time" style="--i:${i}">${avatarHtml(j)}<span class="team-player-name">${escapeHtml(j.name)}</span></li>`)
    .join("");
  vagaResultEl.classList.remove("hidden");
}

btnNovoSorteioVaga.addEventListener("click", () => {
  vagaResultEl.classList.add("hidden");
  selecionados.clear();
  renderizarPicker();
  atualizarContagem();
  msgEl.textContent = "";
  document.getElementById("player-picker").scrollIntoView({ behavior: "smooth", block: "start" });
});

socket.on("sorteio:resultado", ({ timeA, timeB, somaA, somaB }) => {
  clearInterval(roletaInterval);
  pararGiroNomes(roletaNomeEl);
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
// Mapas que já saíram (vem do servidor, igual pra todo mundo).
let mapasSorteados = new Set();

function renderizarMapPicker() {
  mapPickerEl.innerHTML = MAPAS.map((m) => {
    const sorteado = mapasSorteados.has(m.id);
    const marcado = mapaSelecionados.has(m.id) && !sorteado;
    return `
      <div class="map-tile ${marcado ? "selected" : ""} ${sorteado ? "sorteado" : ""}" data-id="${m.id}" style="background-image:url('${m.img}')" role="button" tabindex="0" aria-pressed="${marcado}" ${sorteado ? 'aria-disabled="true"' : ""}>
        <div class="map-tile-check">✓</div>
        ${sorteado ? `<span class="map-tile-badge">Já sorteado</span><button type="button" class="map-tile-voltar" data-voltar="${m.id}" title="Devolver este mapa ao sorteio">↩ Voltar ao sorteio</button>` : ""}
        <span class="map-tile-name">${escapeHtml(m.name)}</span>
      </div>
    `;
  }).join("");

  mapPickerEl.querySelectorAll(".map-tile-voltar").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        const res = await fetch("/api/mapa/devolver", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mapaId: btn.dataset.voltar }),
        });
        if (!res.ok) throw new Error();
        mapaSelecionados.add(btn.dataset.voltar);
      } catch {
        mapaMsgEl.textContent = "Não consegui devolver o mapa. Tente de novo.";
      }
    });
  });

  mapPickerEl.querySelectorAll(".map-tile").forEach((tile) => {
    const alternar = () => {
      const id = tile.dataset.id;
      if (mapasSorteados.has(id)) return; // já sorteado: só volta pelo botão
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

function mapasDisponiveis() {
  return Array.from(mapaSelecionados).filter((id) => !mapasSorteados.has(id));
}

function atualizarContagemMapa() {
  const n = mapasDisponiveis().length;
  const ja = mapasSorteados.size;
  mapSelectedCountEl.textContent =
    `${n} selecionado${n === 1 ? "" : "s"}` + (ja ? ` · ${ja} já sorteado${ja === 1 ? "" : "s"}` : "");
  btnSortearMapa.disabled = n < 1;
}

renderizarMapPicker();
atualizarContagemMapa();

btnSortearMapa.addEventListener("click", async () => {
  mapaMsgEl.textContent = "";
  btnSortearMapa.disabled = true;
  btnSortearMapa.textContent = "Sorteando…";

  try {
    const mapas = mapasDisponiveis();
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
    btnSortearMapa.disabled = mapasDisponiveis().length < 1;
    btnSortearMapa.textContent = "Sortear mapa";
  }
});

// Faixa com a ordem em que os mapas saíram (1º, 2º, 3º...).
const mapHistoryEl = document.getElementById("map-history");

function renderizarHistoricoMapas(lista) {
  mapHistoryEl.innerHTML = lista
    .map((id, i) => {
      const m = MAPAS.find((x) => x.id === id);
      return `<span class="map-chip"><b>${i + 1}º</b>${escapeHtml(m ? m.name : id)}</span>`;
    })
    .join("");
}

socket.on("mapa:sorteados", (lista) => {
  mapasSorteados = new Set(lista);
  renderizarMapPicker();
  atualizarContagemMapa();
  renderizarHistoricoMapas(lista);
});

// Roleta: o destaque passa pelos mapas e vai desacelerando até o sorteado.
let roletaMapaTimer = null;

function marcarRoda(id) {
  mapPickerEl.querySelectorAll(".map-tile.roda").forEach((t) => t.classList.remove("roda"));
  const tile = mapPickerEl.querySelector(`.map-tile[data-id="${id}"]`);
  if (tile) tile.classList.add("roda");
}

function pararRoletaMapa() {
  clearTimeout(roletaMapaTimer);
  mapPickerEl.querySelectorAll(".map-tile.roda").forEach((t) => t.classList.remove("roda"));
}

function girarMapas(candidatos, alvo, duracao) {
  pararRoletaMapa();
  const n = candidatos.length;
  const passos = 24; // mais passos = roleta mais rápida e com mais voltas
  // Sequência embaralhada: cada passo salta pra um mapa aleatório (sem repetir
  // o anterior) e o último passo é sempre o mapa sorteado pelo servidor.
  const seq = [];
  if (n === 2) {
    // Com só 2 mapas não tem como embaralhar: eles se alternam até o sorteado.
    const outro = candidatos.find((id) => id !== alvo);
    for (let k = 0; k < passos; k++) seq.push((passos - 1 - k) % 2 === 0 ? alvo : outro);
  }
  for (let k = 0; n !== 2 && k < passos - 1; k++) {
    const evitar = new Set([seq[k - 1], k === passos - 2 ? alvo : null]);
    if (n > 3) evitar.add(seq[k - 2]);
    let opcoes = candidatos.filter((id) => !evitar.has(id));
    if (!opcoes.length) opcoes = candidatos;
    seq.push(opcoes[Math.floor(Math.random() * opcoes.length)]);
  }
  if (n !== 2) seq.push(alvo);
  // Começa quase num borrão e desacelera no fim: cada intervalo é 14% maior
  // que o anterior, e todos são escalados pra somar exatamente "duracao".
  const pesos = seq.map((_, k) => Math.pow(1.14, k));
  const escala = duracao / pesos.reduce((x, y) => x + y, 0);
  let k = 0;
  const passo = () => {
    marcarRoda(seq[k]);
    if (++k < seq.length) roletaMapaTimer = setTimeout(passo, pesos[k - 1] * escala);
  };
  passo();
}

socket.on("mapa:iniciado", ({ mapas, mapaId, duracao }) => {
  if (Array.isArray(mapas) && mapaId) girarMapas(mapas, mapaId, duracao || 4000);
  mapaMsgEl.textContent = "";
  mapResultEl.classList.add("hidden");
  mapaLiveEl.classList.remove("hidden");
  btnSortearMapa.disabled = true;
  btnSortearMapa.textContent = "Sorteando…";
});

socket.on("mapa:resultado", ({ mapaId }) => {
  pararRoletaMapa();
  const mapa = MAPAS.find((m) => m.id === mapaId);
  mapaLiveEl.classList.add("hidden");
  mapResultNameEl.textContent = mapa ? mapa.name : mapaId;
  mapResultEl.style.backgroundImage = mapa ? `url('${mapa.img}')` : "none";
  mapResultEl.classList.remove("hidden");
  mapResultEl.classList.remove("revelar");
  void mapResultEl.offsetWidth; // reinicia a animação de revelação
  mapResultEl.classList.add("revelar");
  btnSortearMapa.textContent = "Sortear mapa";
  btnSortearMapa.disabled = mapasDisponiveis().length < 1;
});

function renderizarTimes(timeA, timeB, somaA, somaB) {
  document.getElementById("team-a-total").textContent = `força ${somaA}`;
  document.getElementById("team-b-total").textContent = `força ${somaB}`;

  document.getElementById("team-a-list").innerHTML = timeA
    .map((j, i) => `<li class="entra-time" style="--i:${i}">${avatarHtml(j)}<span class="team-player-name">${escapeHtml(j.name)}</span> <span class="pts tier-badge tier-${j.tier}">R${j.tier}</span></li>`)
    .join("");

  document.getElementById("team-b-list").innerHTML = timeB
    .map((j, i) => `<li class="entra-time" style="--i:${i}">${avatarHtml(j)}<span class="team-player-name">${escapeHtml(j.name)}</span> <span class="pts tier-badge tier-${j.tier}">R${j.tier}</span></li>`)
    .join("");

  atualizarBarraEquilibrio(somaA, somaB);
  teamsResultEl.classList.remove("hidden");
}

// Barra mostrando a força de cada lado e se o sorteio ficou justo.
function atualizarBarraEquilibrio(somaA, somaB) {
  const barA = document.getElementById("bal-a");
  const barB = document.getElementById("bal-b");
  const total = (somaA + somaB) || 1;
  barA.style.width = "50%";
  barB.style.width = "50%";
  requestAnimationFrame(() => requestAnimationFrame(() => {
    barA.style.width = `${(somaA / total) * 100}%`;
    barB.style.width = `${(somaB / total) * 100}%`;
  }));
  document.getElementById("bal-fa").textContent = `A · ${somaA}`;
  document.getElementById("bal-fb").textContent = `B · ${somaB}`;
  const dif = Math.abs(somaA - somaB);
  const diffEl = document.getElementById("bal-diff");
  diffEl.textContent = dif === 0 ? "Perfeitamente equilibrado" : `Diferença: ${dif}`;
  diffEl.classList.toggle("ok", dif <= 1);
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
      .map((h, idx) => {
        const data = new Date(h.criado_em);
        const dataFmt = data.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        const nomesA = h.timeA.map((j) => escapeHtml(j.name)).join(", ");
        const nomesB = h.timeB.map((j) => escapeHtml(j.name)).join(", ");
        return `
          <div class="history-item" style="--i:${Math.min(idx, 8)}">
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



// ---------- Cabeçalho: sublinhado que desliza entre as abas + modo compacto ao rolar ----------
(function cabecalho() {
  const slider = document.getElementById("tab-slider");
  const topbar = document.querySelector(".topbar");

  function moverSlider() {
    const ativa = document.querySelector(".tab-btn.active");
    if (!slider || !ativa) return;
    slider.style.left = ativa.offsetLeft + "px";
    slider.style.width = ativa.offsetWidth + "px";
  }

  document.querySelectorAll(".tab-btn").forEach((b) => b.addEventListener("click", moverSlider));
  window.addEventListener("resize", moverSlider);
  window.addEventListener("load", moverSlider);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(moverSlider);
  moverSlider();

  function compactar() {
    if (topbar) topbar.classList.toggle("compacta", window.scrollY > 30);
  }
  window.addEventListener("scroll", compactar, { passive: true });
  compactar();
})();
