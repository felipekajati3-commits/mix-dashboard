// ============================================================
//  PAINEL DE ADMIN
//  Edita a lista de jogadores e o nivel (1 a 5) de cada um. Tudo fica
//  so na memoria do navegador ate clicar em "Salvar alteracoes" - so
//  ai vai pro servidor de uma vez.
// ============================================================

const TIERS = [1, 2, 3, 4, 5];

let jogadores = []; // { id, tipo, steam_id, nome, tier }
let alterado = false;

const telaLogin = document.getElementById("tela-login");
const telaPainel = document.getElementById("tela-painel");
const btnLogin = document.getElementById("btn-login");
const inputSenha = document.getElementById("input-senha");
const loginMsg = document.getElementById("login-msg");
const btnLogout = document.getElementById("btn-logout");
const rankingsEl = document.getElementById("rankings");
const btnSalvar = document.getElementById("btn-salvar");
const adminMsg = document.getElementById("admin-msg");
const contagemEl = document.getElementById("admin-contagem");
const saveStateEl = document.getElementById("save-state");
const inputBusca = document.getElementById("input-busca");
const selectTierNovo = document.getElementById("select-tier-novo");
const resultadoBusca = document.getElementById("resultado-busca");

function escapeHtml(t) {
  return String(t ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function novoId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function marcarAlterado() {
  alterado = true;
  btnSalvar.disabled = false;
  saveStateEl.textContent = "alterações não salvas";
}

// ---------------- Login ----------------

async function verificarLogin() {
  const res = await fetch("/api/admin/status");
  const data = await res.json();

  if (data.logado) {
    telaLogin.classList.add("hidden");
    telaPainel.classList.remove("hidden");
    btnLogout.classList.remove("hidden");
    if (!data.salvandoNoGitHub) {
      adminMsg.textContent =
        "Atenção: o GITHUB_TOKEN não está configurado, então as alterações ficam só neste servidor e somem no próximo deploy.";
    }
    carregarRankings();
  } else {
    telaLogin.classList.remove("hidden");
    telaPainel.classList.add("hidden");
    btnLogout.classList.add("hidden");
    inputSenha.focus();
  }
}

async function entrar() {
  loginMsg.textContent = "";
  btnLogin.disabled = true;
  try {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senha: inputSenha.value }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Não consegui entrar.");
    }
    inputSenha.value = "";
    verificarLogin();
  } catch (err) {
    loginMsg.textContent = err.message;
  } finally {
    btnLogin.disabled = false;
  }
}

btnLogin.addEventListener("click", entrar);
inputSenha.addEventListener("keydown", (e) => {
  if (e.key === "Enter") entrar();
});

btnLogout.addEventListener("click", async () => {
  await fetch("/api/admin/logout", { method: "POST" });
  location.reload();
});

// ---------------- Lista de jogadores ----------------

async function carregarRankings() {
  rankingsEl.innerHTML = `<div class="loading">Carregando…</div>`;
  try {
    const res = await fetch("/api/rankings");
    const data = await res.json();
    jogadores = data.jogadores || [];
    alterado = false;
    btnSalvar.disabled = true;
    saveStateEl.textContent = data.atualizado_em
      ? `salvo em ${new Date(data.atualizado_em).toLocaleString("pt-BR")}`
      : "nada salvo ainda";
    renderizar();
  } catch (err) {
    rankingsEl.innerHTML = `<div class="loading">Erro ao carregar os rankings.</div>`;
  }
}

function renderizar() {
  rankingsEl.innerHTML = TIERS.map((tier) => {
    const doTier = jogadores.filter((j) => j.tier === tier);
    const linhas = doTier
      .map(
        (j) => `
        <div class="tier-jogador ${j.tipo === "vaga" ? "vaga" : ""}" data-id="${j.id}">
          <input class="nome-input" value="${escapeHtml(j.nome)}" maxlength="40"
                 placeholder="${j.tipo === "vaga" ? "Nome do jogador novo…" : ""}" />
          <button class="mover" data-acao="subir" title="Subir um nível (ficar mais forte)">▲</button>
          <button class="mover" data-acao="descer" title="Descer um nível (ficar mais fraco)">▼</button>
          <button class="mover remover" data-acao="remover" title="Remover">✕</button>
        </div>`
      )
      .join("");

    return `
      <div class="tier-card" data-tier="${tier}">
        <div class="tier-head">
          <strong>RANK ${tier}</strong>
          <span class="tier-qtd">${doTier.length} ${doTier.length === 1 ? "jogador" : "jogadores"}</span>
        </div>
        <div class="tier-lista">${linhas}</div>
        <button class="btn-vaga" data-vaga="${tier}">+ vaga personalizada</button>
      </div>`;
  }).join("");

  contagemEl.textContent = `${jogadores.length} ${jogadores.length === 1 ? "jogador" : "jogadores"}`;
  ligarEventosDaLista();
}

function ligarEventosDaLista() {
  // Renomear (serve tanto pra corrigir um nome quanto pra preencher a
  // vaga personalizada com quem chegou agora).
  rankingsEl.querySelectorAll(".nome-input").forEach((input) => {
    input.addEventListener("input", () => {
      const id = input.closest(".tier-jogador").dataset.id;
      const j = jogadores.find((x) => x.id === id);
      if (j) {
        j.nome = input.value;
        marcarAlterado();
      }
    });
  });

  // Subir/descer de nível e remover.
  rankingsEl.querySelectorAll(".mover").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.closest(".tier-jogador").dataset.id;
      const j = jogadores.find((x) => x.id === id);
      if (!j) return;

      const acao = btn.dataset.acao;
      if (acao === "remover") {
        jogadores = jogadores.filter((x) => x.id !== id);
      } else if (acao === "subir") {
        j.tier = Math.max(1, j.tier - 1);
      } else {
        j.tier = Math.min(5, j.tier + 1);
      }
      marcarAlterado();
      renderizar();
    });
  });

  // Vaga personalizada: cria uma linha em branco naquele nível, e dá
  // pra clicar quantas vezes quiser (dois novatos no mesmo rank, por
  // exemplo).
  rankingsEl.querySelectorAll(".btn-vaga").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tier = Number(btn.dataset.vaga);
      jogadores.push({ id: novoId(), tipo: "vaga", steam_id: null, nome: "", tier });
      marcarAlterado();
      renderizar();

      // Deixa o cursor já dentro do campo novo, pra só digitar o nome.
      const card = rankingsEl.querySelector(`.tier-card[data-tier="${tier}"]`);
      const inputs = card.querySelectorAll(".nome-input");
      inputs[inputs.length - 1]?.focus();
    });
  });
}

// ---------------- Adicionar jogador ----------------

let buscaTimer;
inputBusca.addEventListener("input", () => {
  clearTimeout(buscaTimer);
  const termo = inputBusca.value.trim();
  if (termo.length < 2) {
    resultadoBusca.classList.add("hidden");
    return;
  }
  buscaTimer = setTimeout(() => buscar(termo), 300);
});

async function buscar(termo) {
  resultadoBusca.classList.remove("hidden");
  resultadoBusca.innerHTML = `<div class="loading">Procurando…</div>`;

  // Se o que foi digitado parece um link ou um ID da Steam, consulta a
  // Steam direto - assim dá pra cadastrar alguém que nunca jogou no
  // servidor e por isso não está na base de pontos.
  const pareceSteam = /steamcommunity\.com|^\d{17}$/.test(termo);

  try {
    if (pareceSteam) {
      const res = await fetch(`/api/admin/steam?q=${encodeURIComponent(termo)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      mostrarResultados([{ steam_id: data.steam_id, name: data.nome, info: "perfil da Steam" }]);
    } else {
      const res = await fetch(`/api/players?q=${encodeURIComponent(termo)}`);
      const data = await res.json();
      mostrarResultados(
        data.slice(0, 30).map((p) => ({ steam_id: p.steam_id, name: p.name, info: `${p.points} pts` }))
      );
    }
  } catch (err) {
    resultadoBusca.innerHTML = `<div class="loading">${escapeHtml(err.message || "Erro na busca.")}</div>`;
  }
}

function mostrarResultados(lista) {
  if (!lista.length) {
    resultadoBusca.innerHTML = `<div class="loading">Ninguém encontrado. Você pode usar a "vaga personalizada" no nível desejado.</div>`;
    return;
  }

  resultadoBusca.innerHTML = lista
    .map(
      (p) => `
      <div class="busca-row" data-steam="${escapeHtml(p.steam_id)}" data-nome="${escapeHtml(p.name)}">
        <span class="busca-nome">${escapeHtml(p.name)}</span>
        <span class="busca-info">${escapeHtml(p.info)}</span>
      </div>`
    )
    .join("");

  resultadoBusca.querySelectorAll(".busca-row").forEach((row) => {
    row.addEventListener("click", () => {
      const steamId = row.dataset.steam;

      if (jogadores.some((j) => j.steam_id === steamId)) {
        adminMsg.textContent = "Esse jogador já está em algum ranking.";
        return;
      }

      jogadores.push({
        id: novoId(),
        tipo: "steam",
        steam_id: steamId,
        nome: row.dataset.nome,
        tier: Number(selectTierNovo.value),
      });

      adminMsg.textContent = "";
      inputBusca.value = "";
      resultadoBusca.classList.add("hidden");
      marcarAlterado();
      renderizar();
    });
  });
}

// ---------------- Salvar ----------------

btnSalvar.addEventListener("click", async () => {
  const vazios = jogadores.filter((j) => !j.nome.trim());
  if (vazios.length) {
    adminMsg.textContent = "Tem vaga personalizada sem nome. Preencha ou remova antes de salvar.";
    return;
  }

  btnSalvar.disabled = true;
  btnSalvar.textContent = "Salvando…";
  adminMsg.textContent = "";

  try {
    const res = await fetch("/api/admin/rankings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jogadores }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erro ao salvar.");

    alterado = false;
    saveStateEl.textContent = `salvo em ${new Date(data.atualizado_em).toLocaleString("pt-BR")}`;
    adminMsg.textContent = "Rankings salvos.";
  } catch (err) {
    adminMsg.textContent = err.message;
    btnSalvar.disabled = false;
  } finally {
    btnSalvar.textContent = "Salvar alterações";
  }
});

// Avisa antes de fechar a aba com alteração pendente.
window.addEventListener("beforeunload", (e) => {
  if (alterado) e.preventDefault();
});

verificarLogin();
