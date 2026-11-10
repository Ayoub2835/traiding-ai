// Núcleo tipo reactor con anillos de LEDs RGB animados.
// Reacciona al volumen del micrófono (cuando escuchas) y a la voz de Jarvis.
'use strict';

class Nucleo {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.colorBase = '#00e5ff';
    this.modoRgb = true;
    this.estado = 'reposo';   // reposo | escuchando | pensando | hablando | error
    this.nivelObjetivo = 0;   // 0..1 que llega del micro / de la voz
    this.nivel = 0;           // valor suavizado
    this.t = 0;
    this._ajustarTamano();
    window.addEventListener('resize', () => this._ajustarTamano());
    requestAnimationFrame((ts) => this._dibujar(ts));
  }

  setNivel(n) { this.nivelObjetivo = Math.max(0, Math.min(1, n || 0)); }
  setEstado(e) { this.estado = e; }
  setColor(hex, rgb) { this.colorBase = hex; this.modoRgb = rgb; }

  _ajustarTamano() {
    const r = window.devicePixelRatio || 1;
    const lado = Math.max(200, this.canvas.clientWidth || 600);
    this.canvas.width = this.canvas.height = Math.round(lado * r);
  }

  // Tono (hue) del color base, para desplazarlo en modo RGB.
  _hueBase() {
    const h = this.colorBase.replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d === 0) return 0;
    let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (hue * 60 + 360) % 360;
  }

  _color(desfase, luz = 60, alfa = 1) {
    if (this.estado === 'error') return `hsla(350, 100%, ${luz}%, ${alfa})`;
    const h = this.modoRgb ? (this._hueBase() + desfase + this.t * 40) % 360 : this._hueBase();
    return `hsla(${h}, 100%, ${luz}%, ${alfa})`;
  }

  _dibujar(ts) {
    const { ctx, canvas } = this;
    const dt = 1 / 60;
    this.t += dt;
    // Suavizado del nivel (sube rápido, baja despacio)
    const k = this.nivelObjetivo > this.nivel ? 0.35 : 0.08;
    this.nivel += (this.nivelObjetivo - this.nivel) * k;

    const W = canvas.width, c = W / 2, R = W * 0.46;
    ctx.clearRect(0, 0, W, W);
    ctx.globalCompositeOperation = 'lighter';

    const velocidad = { reposo: 0.25, escuchando: 0.6, pensando: 2.2, hablando: 0.9, error: 0.1 }[this.estado] || 0.3;
    const pulso = 0.5 + 0.5 * Math.sin(this.t * (this.estado === 'pensando' ? 6 : 2));
    const energia = Math.min(1, 0.25 + this.nivel * 0.9 + (this.estado === 'pensando' ? pulso * 0.3 : 0));

    // Anillos de LEDs: [radio relativo, nº de LEDs, sentido de giro, desfase de color]
    const anillos = [[0.95, 72, 1, 0], [0.80, 56, -1, 60], [0.64, 40, 1, 120], [0.48, 28, -1, 200]];
    anillos.forEach(([rr, n, sentido, desf], idx) => {
      const radio = R * rr * (1 + this.nivel * 0.04 * (idx + 1));
      const giro = this.t * velocidad * sentido * (0.6 + idx * 0.2);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + giro;
        // Onda que recorre el anillo: unos LEDs brillan más que otros
        const onda = 0.5 + 0.5 * Math.sin(a * 3 - this.t * 4 * sentido + idx);
        const brillo = Math.min(1, 0.15 + energia * onda);
        const x = c + Math.cos(a) * radio, y = c + Math.sin(a) * radio;
        const tam = W * (0.006 + 0.004 * brillo) * (1.2 - idx * 0.12);
        const col = this._color(desf + (i / n) * 360, 50 + brillo * 25, brillo);
        ctx.shadowBlur = W * 0.02 * brillo;
        ctx.shadowColor = col;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(x, y, tam, 0, Math.PI * 2);
        ctx.fill();
      }
      // Trazo fino del anillo
      ctx.shadowBlur = 0;
      ctx.strokeStyle = this._color(desf, 50, 0.12 + energia * 0.15);
      ctx.lineWidth = W * 0.002;
      ctx.beginPath();
      ctx.arc(c, c, radio, 0, Math.PI * 2);
      ctx.stroke();
    });

    // Segmentos tipo reactor (arcos) que giran
    for (let s = 0; s < 6; s++) {
      const ini = (s / 6) * Math.PI * 2 + this.t * velocidad * 0.8;
      ctx.strokeStyle = this._color(s * 60, 55, 0.35 + energia * 0.5);
      ctx.lineWidth = W * 0.012;
      ctx.shadowBlur = W * 0.03;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.beginPath();
      ctx.arc(c, c, R * 0.33, ini, ini + Math.PI / 6);
      ctx.stroke();
    }

    // "Procesando": tres cometas que giran y un anillo de escaneo que se expande
    if (this.estado === 'pensando') {
      for (let k = 0; k < 3; k++) {
        const ang = this.t * (2.5 + k * 0.9) * (k % 2 ? -1 : 1) + (k * Math.PI * 2) / 3;
        const radio = R * (0.56 + k * 0.17);
        for (let j = 0; j < 18; j++) {
          const a = ang - j * 0.06 * (k % 2 ? -1 : 1);
          const alfa = (1 - j / 18) * 0.9;
          const col = this._color(k * 120 + j * 4, 65, alfa);
          ctx.shadowBlur = W * 0.025;
          ctx.shadowColor = col;
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(c + Math.cos(a) * radio, c + Math.sin(a) * radio, W * 0.009 * (1 - j / 22), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      const fase = (this.t * 0.7) % 1;
      ctx.shadowBlur = 0;
      ctx.strokeStyle = this._color(0, 60, 0.5 * (1 - fase));
      ctx.lineWidth = W * 0.004;
      ctx.beginPath();
      ctx.arc(c, c, R * (0.2 + fase * 0.8), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Núcleo central brillante que "respira" con la voz
    // Al hablar, el núcleo late con más fuerza siguiendo el volumen real de la voz.
    const latido = this.estado === 'hablando' ? 0.16 : 0.08;
    const rNucleo = R * (0.17 + this.nivel * latido + pulso * 0.01);
    const grad = ctx.createRadialGradient(c, c, 0, c, c, rNucleo * 1.9);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.35, this._color(0, 65, 0.9));
    grad.addColorStop(1, this._color(0, 40, 0));
    ctx.shadowBlur = 0;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(c, c, rNucleo * 1.9, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'source-over';
    requestAnimationFrame((t2) => this._dibujar(t2));
  }
}

// Fondo: rejilla tenue y partículas flotando.
function iniciarFondo(canvas, obtenerColor) {
  const ctx = canvas.getContext('2d');
  const particulas = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), v: 0.0002 + Math.random() * 0.0006, r: Math.random() * 1.6 + 0.3 }));
  const redimensionar = () => { canvas.width = innerWidth; canvas.height = innerHeight; };
  redimensionar();
  addEventListener('resize', redimensionar);
  (function dibujar() {
    const { width: W, height: H } = canvas;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.025)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.fillStyle = obtenerColor();
    for (const p of particulas) {
      p.y -= p.v; if (p.y < 0) { p.y = 1; p.x = Math.random(); }
      ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.arc(p.x * W, p.y * H, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(dibujar);
  })();
}

window.Nucleo = Nucleo;
window.iniciarFondo = iniciarFondo;
