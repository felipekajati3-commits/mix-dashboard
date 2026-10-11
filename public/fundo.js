// Fundo sutil: partículas douradas subindo devagar.
// Reage ao sorteio: window.fundoIntensidade(1) acelera, brilha e acende um
// halo dourado; fundoIntensidade(0) volta suavemente ao normal.
// Desligado quando o sistema pede "reduzir movimento".
(function () {
  window.fundoIntensidade = function () {};
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = document.getElementById("particulas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let w = 0, h = 0, particulas = [], alvo = 0, nivel = 0, seguranca = null;

  function ajustar() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
    const qtd = Math.min(60, Math.round((w * h) / 28000));
    particulas = Array.from({ length: qtd }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.3 + 0.4,
      v: Math.random() * 0.22 + 0.06,
      o: Math.random() * 0.3 + 0.08,
      f: Math.random() * 6,
    }));
  }
  window.addEventListener("resize", ajustar);
  ajustar();

  window.fundoIntensidade = function (v) {
    alvo = v;
    clearTimeout(seguranca);
    // Trava de segurança: se o fim do sorteio não chegar (queda de conexão,
    // por exemplo), o fundo volta sozinho ao normal.
    if (v > 0) seguranca = setTimeout(() => (alvo = 0), 15000);
  };

  function quadro(t) {
    nivel += (alvo - nivel) * 0.05;
    if (!document.hidden) {
      ctx.clearRect(0, 0, w, h);
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
    requestAnimationFrame(quadro);
  }
  requestAnimationFrame(quadro);
})();
