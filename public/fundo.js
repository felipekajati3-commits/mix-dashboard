// Fundo sutil: partículas douradas muito discretas subindo devagar.
// Desligado quando o sistema pede "reduzir movimento".
(function () {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = document.getElementById("particulas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let w = 0, h = 0, particulas = [];

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

  function quadro(t) {
    if (!document.hidden) {
      ctx.clearRect(0, 0, w, h);
      for (const p of particulas) {
        p.y -= p.v;
        p.x += Math.sin(t / 3000 + p.f) * 0.15;
        if (p.y < -5) { p.y = h + 5; p.x = Math.random() * w; }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(212, 175, 55, ${p.o * (0.6 + 0.4 * Math.sin(t / 1500 + p.f))})`;
        ctx.fill();
      }
    }
    requestAnimationFrame(quadro);
  }
  requestAnimationFrame(quadro);
})();
