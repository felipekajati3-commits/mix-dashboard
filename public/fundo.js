// Fundo do site: agente de CS2 no vão à esquerda do conteúdo + partículas douradas.
//
// - O agente fica na área livre à esquerda da aba aberta (Ranking, Mapa...), então
//   não passa atrás do conteúdo. Nas abas largas (Sorteio, Temporadas) ele fica
//   atrás do conteúdo, mais apagado. No Histórico de Partidas não aparece.
// - A brasa do cigarro, a fumaça e a neblina se mexem devagar. Ao sortear,
//   window.fundoIntensidade(1) acende a brasa (vermelho forte), acelera as
//   partículas e acende um halo dourado; fundoIntensidade(0) volta ao normal.
// - Com "reduzir movimento" no sistema, o agente fica parado e sem efeitos.
(function () {
  window.fundoIntensidade = function () {};
  const canvas = document.getElementById("particulas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const reduzir = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ===================== AJUSTES =====================
  // A imagem é tratada como 2560x1440. Coordenadas (focoX, pontaX, pontaY)
  // são nesse tamanho: se trocar a imagem, é só mudar esses números.
  const AGENTE = {
    src: "assets/fundo-agente.webp",
    largura: 2560,
    altura: 1440,
    focoX: 910,   // ponto da imagem que fica no centro do recorte
    pontaX: 1316, // ponta do cigarro (onde fica a brasa)
    pontaY: 409,
  };
  const OPACIDADE = 0.55;         // opacidade do agente no vão livre
  const OPACIDADE_ATRAS = 0.42;   // opacidade quando fica atrás do conteúdo
  const ABAS_ATRAS = ["sorteio", "temporadas"]; // abas largas: agente atrás do conteúdo
  const ABAS_SEM_AGENTE = ["partidas"];         // abas sem agente
  const VAO_MIN = 300;            // vão mínimo (px) para o agente aparecer
  const VAO_MAX = 720;            // largura máxima da área do agente
  const PROPORCAO_ATRAS = 0.365;  // largura da área nas abas "atrás" (fração da tela)
  // ===================================================

  let w = 0, h = 0, dpr = 1;
  let particulas = [], fumaca = [];
  let alvo = 0, nivel = 0, sopro = 0, seguranca = null;
  let mx = 0, my = 0, mxAlvo = 0, myAlvo = 0, ultFumaca = 0, ultimo = 0;
  let vis = 0, larg = 0, opAtual = OPACIDADE, pronta = false;
  const camada = document.createElement("canvas");
  const cctx = camada.getContext("2d");
  const img = new Image();

  function ajustar() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const qtd = Math.min(60, Math.round((w * h) / 28000));
    particulas = Array.from({ length: qtd }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.3 + 0.4,
      v: Math.random() * 0.22 + 0.06,
      o: Math.random() * 0.3 + 0.08,
      f: Math.random() * 6,
    }));
    redesenhar();
  }

  // Vão livre à esquerda da aba ativa (abaixo do topo).
  function vao() {
    const aba = document.querySelector(".tab-btn.active")?.dataset.tab || "ranking";
    const topo = document.querySelector(".topbar");
    const ry = (topo ? Math.round(topo.getBoundingClientRect().bottom) : 0) + 4;
    let gap = 0;
    if (ABAS_SEM_AGENTE.includes(aba)) gap = 0;
    else if (ABAS_ATRAS.includes(aba)) gap = Math.min(VAO_MAX, w * PROPORCAO_ATRAS);
    else {
      const main = document.querySelector("main");
      const painel = document.getElementById("tab-" + aba);
      if (main && painel) {
        const mr = main.getBoundingClientRect();
        const pad = parseFloat(getComputedStyle(main).paddingLeft) || 0;
        const cw = mr.width - pad * 2;
        const mw = parseFloat(getComputedStyle(painel).maxWidth);
        const pw = isNaN(mw) ? cw : Math.min(cw, mw);
        gap = Math.min(VAO_MAX, mr.left + pad + (cw - pw) / 2 - 24);
      }
    }
    return { gap, ry, atras: ABAS_ATRAS.includes(aba), ok: gap >= VAO_MIN };
  }

  // Esmaece a borda da camada (curva suave, sem degrau).
  function borda(x0, y0, x1, y1, a0, a1, rw, rh) {
    const g = cctx.createLinearGradient(x0, y0, x1, y1);
    for (let i = 0; i <= 8; i++) {
      const s = i / 8, e = s * s * (3 - 2 * s);
      g.addColorStop(s, `rgba(0,0,0,${a0 + (a1 - a0) * e})`);
    }
    cctx.fillStyle = g;
    cctx.fillRect(0, 0, rw, rh);
  }

  function desenhar(t, dt) {
    ctx.clearRect(0, 0, w, h);
    const v = vao();
    const alvoVis = pronta && v.ok ? 1 : 0;
    if (reduzir) { vis = alvoVis; if (v.ok) larg = v.gap; }
    else {
      vis += (alvoVis - vis) * 0.12;
      if (v.ok) larg += (v.gap - larg) * (larg < 1 ? 1 : 0.15);
      opAtual += ((v.atras ? OPACIDADE_ATRAS : OPACIDADE) - opAtual) * 0.15;
    }

    if (vis < 0.01 || larg < 60) {
      fumaca.length = 0;
    } else {
      const rw = Math.round(larg), rx = 8, ry = v.ry, rh = h - ry;
      if (camada.width !== rw || camada.height !== rh) { camada.width = rw; camada.height = rh; }
      const AW = AGENTE.largura, AH = AGENTE.altura;
      const z = 1.02 + 0.02 * Math.sin(t / 16000); // zoom lento
      const sh = AH / z, sw = Math.min(AW, (rw * sh) / rh);
      const sx = Math.max(0, Math.min(AW - sw, AGENTE.focoX - sw / 2 - mx * 20));
      const sy = Math.max(0, (AH - sh) * 0.55 - my * 10);
      const f = img.naturalWidth / AW;

      cctx.globalCompositeOperation = "source-over";
      cctx.clearRect(0, 0, rw, rh);
      cctx.drawImage(img, sx * f, sy * f, sw * f, sh * f, 0, 0, rw, rh);
      cctx.globalCompositeOperation = "destination-out"; // bordas se dissolvem
      borda(0, 0, rw * 0.14, 0, 1, 0, rw, rh);
      borda(rw * 0.5, 0, rw, 0, 0, 1, rw, rh);
      borda(0, 0, 0, rh * 0.1, 1, 0, rw, rh);
      borda(0, rh * 0.86, 0, rh, 0, 1, rw, rh);
      ctx.globalAlpha = Math.min(1, opAtual * (1 + 0.05 * Math.sin(t / 2300)) * (1 + 0.9 * nivel)) * vis;
      ctx.drawImage(camada, rx, ry);
      ctx.globalAlpha = 1;

      if (!reduzir) {
        // neblina à deriva
        for (let k = 0; k < 3; k++) {
          const fx = ((t / (70000 + k * 18000) + k * 0.37) % 1) * w * 1.7 - w * 0.35;
          const fy = h * (0.5 + k * 0.17), fr = Math.max(w, h) * 0.42;
          const fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, fr);
          fg.addColorStop(0, `rgba(205,185,150,${(0.035 + 0.05 * nivel) * vis})`);
          fg.addColorStop(1, "rgba(205,185,150,0)");
          ctx.fillStyle = fg;
          ctx.fillRect(fx - fr, fy - fr, fr * 2, fr * 2);
        }
        const ppx = rw / sw, K = ppx / 0.6;
        const tx = rx + (AGENTE.pontaX - sx) * ppx, ty = ry + (AGENTE.pontaY - sy) * ppx;

        // fumaça saindo da ponta do cigarro
        const gapAtivo = Math.abs(v.gap - larg) < 3;
        if (!gapAtivo) fumaca.length = 0;
        if (t - ultFumaca > 110 / (1 + 2.5 * nivel) && fumaca.length < 70 && vis > 0.9 && gapAtivo) {
          ultFumaca = t;
          fumaca.push({ x: tx, y: ty, vy: -(0.22 + Math.random() * 0.2) * (1 + nivel), s: Math.random() * 6, a: 0, m: 5000 + Math.random() * 2500 });
        }
        for (let q = fumaca.length - 1; q >= 0; q--) {
          const p = fumaca[q];
          p.a += dt;
          if (p.a > p.m) { fumaca.splice(q, 1); continue; }
          p.y += (p.vy * dt) / 16;
          p.x += Math.sin(p.a / 700 + p.s) * 0.28;
          const vida = 1 - p.a / p.m, r = (4 + p.a / 80) * K;
          const al = 0.09 * vida * Math.min(1, p.a / 500) * (1 + 0.5 * nivel) * vis;
          const sg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          sg.addColorStop(0, `rgba(215,205,195,${al})`);
          sg.addColorStop(1, "rgba(215,205,195,0)");
          ctx.fillStyle = sg;
          ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
        }

        // brasa: acende forte no sorteio (nivel) e dá uma tragada no começo (sopro)
        const pulso = 0.55 + 0.45 * Math.sin(t / 900);
        const tragada = Math.pow(Math.max(0, Math.sin(t / 3100)), 6) * 0.5;
        ctx.globalCompositeOperation = "lighter";
        const sr = (60 + 150 * nivel + 80 * sopro) * K, sa = (0.05 + 0.2 * nivel + 0.18 * sopro) * vis;
        const sg2 = ctx.createRadialGradient(tx, ty, 0, tx, ty, sr); // luz avermelhada
        sg2.addColorStop(0, `rgba(255,80,30,${sa})`);
        sg2.addColorStop(1, "rgba(255,60,20,0)");
        ctx.fillStyle = sg2;
        ctx.fillRect(tx - sr, ty - sr, sr * 2, sr * 2);
        const br = (14 + 34 * nivel + 20 * sopro) * K;
        const ba = Math.min(1, 0.38 * pulso + tragada * 0.8 + 0.6 * nivel + 0.7 * sopro) * vis;
        const bg = ctx.createRadialGradient(tx, ty, 0, tx, ty, br);
        bg.addColorStop(0, `rgba(255,210,140,${ba})`);
        bg.addColorStop(0.35, `rgba(255,90,25,${ba * 0.8})`);
        bg.addColorStop(1, "rgba(255,50,10,0)");
        ctx.fillStyle = bg;
        ctx.fillRect(tx - br, ty - br, br * 2, br * 2);
        ctx.globalCompositeOperation = "source-over";
      }
    }

    if (reduzir) return;
    // halo dourado e partículas (comportamento original)
    if (nivel > 0.01) {
      const g = ctx.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, Math.max(w, h) * 0.6);
      g.addColorStop(0, `rgba(212, 175, 55, ${0.16 * nivel})`);
      g.addColorStop(1, "rgba(212, 175, 55, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    const vel = 1 + 7 * nivel, brilho = 1 + 1.4 * nivel, tam = 1 + 0.7 * nivel;
    for (const p of particulas) {
      p.y -= p.v * vel;
      p.x += Math.sin(t / 3000 + p.f) * 0.15 * (1 + nivel * 2);
      if (p.y < -5) { p.y = h + 5; p.x = Math.random() * w; }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * tam, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(212, 175, 55, ${Math.min(1, p.o * brilho * (0.6 + 0.4 * Math.sin(t / 1500 + p.f)))})`;
      ctx.fill();
    }
  }

  function redesenhar() { if (reduzir && pronta) desenhar(0, 0); }

  function quadro(t) {
    const dt = Math.min(60, t - ultimo);
    ultimo = t;
    nivel += (alvo - nivel) * 0.05;
    sopro = Math.max(0, sopro - dt / 1700);
    mx += (mxAlvo - mx) * 0.05;
    my += (myAlvo - my) * 0.05;
    if (!document.hidden) desenhar(t, dt);
    requestAnimationFrame(quadro);
  }

  window.fundoIntensidade = function (v) {
    if (v > 0 && alvo === 0) sopro = 1; // tragada no começo do sorteio
    alvo = v;
    clearTimeout(seguranca);
    // Trava de segurança: se o fim do sorteio não chegar (queda de conexão,
    // por exemplo), o fundo volta sozinho ao normal.
    if (v > 0) seguranca = setTimeout(() => (alvo = 0), 15000);
  };

  window.addEventListener("resize", ajustar);
  window.addEventListener("pointermove", (e) => {
    mxAlvo = e.clientX / window.innerWidth - 0.5;
    myAlvo = e.clientY / window.innerHeight - 0.5;
  });
  document.querySelectorAll(".tab-btn").forEach((b) => b.addEventListener("click", () => setTimeout(redesenhar, 200)));
  img.onload = () => { pronta = true; redesenhar(); };
  img.src = AGENTE.src;
  ajustar();
  if (!reduzir) requestAnimationFrame(quadro);
})();
