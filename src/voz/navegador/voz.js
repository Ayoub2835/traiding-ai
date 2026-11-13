// Voz de Jarvis.
//  - Grabadora: graba el micrófono (MediaRecorder) y corta sola tras un
//    silencio (AnalyserNode). El audio se envía a tu n8n, que lo transcribe
//    en cualquier idioma (español, dárija, árabe, francés...).
//  - Reproductor: reproduce la voz de Jarvis (mp3 que devuelve n8n) y da el
//    volumen REAL del audio para animar el núcleo.
//  - Pitidos: sonido corto al empezar y al terminar de escuchar.
//  - Vosk (100 % local, sin conexión): palabra de activación "Jarvis" y
//    respaldo para transcribir si n8n no responde.
//  - Boca: voz de Windows, solo como respaldo si n8n no puede dar audio.
(() => {
'use strict';

const URL_MODELO = 'jarvis://app/modelo/modelo-es.tar.gz';

// Palabra de activación. El modelo español no trae "Jarvis" en su vocabulario,
// así que el reconocedor se limita a una gramática mínima: o oye "jarvis" o
// cualquier otra cosa ("[unk]"). Probado: lo detecta pronunciado en español,
// inglés y francés, con muy pocas falsas alarmas.
const GRAMATICA_ACTIVACION = JSON.stringify(['jarvis', '[unk]']);
const PATRON_ACTIVACION = /\bjarvis\b/i;

// Nivel (RMS) de un trozo de audio, 0..1 aprox.
function rms(datos) {
  let suma = 0;
  for (let i = 0; i < datos.length; i++) suma += datos[i] * datos[i];
  return Math.sqrt(suma / datos.length);
}

// ---------------------------------------------------------------------------
// Micrófono
// ---------------------------------------------------------------------------
async function abrirMicrofono() {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: false,
    });
  } catch (e) {
    throw new Error('No se pudo usar el micrófono: ' + (e.message || e.name)
      + '. Revisa Configuración de Windows → Privacidad → Micrófono.');
  }
}

// ---------------------------------------------------------------------------
// Grabadora: pulsa para hablar; corta sola tras X segundos de silencio
// ---------------------------------------------------------------------------
class Grabadora {
  constructor() {
    this.activa = false;
    this._fin = null;
  }

  /**
   * Graba una frase.
   * @returns {Promise<{blob: Blob|null, mime: string, hablado: boolean, cancelada: boolean, segundos: number}>}
   */
  async grabar({ alNivel = () => {}, silencio = 1.5, esperaInicial = 8, maximo = 45 } = {}) {
    if (this.activa) this.cancelar();
    const stream = await abrirMicrofono();
    const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm']
      .find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
    const grabador = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const ctx = new AudioContext();
    const analizador = ctx.createAnalyser();
    analizador.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(analizador);
    const muestras = new Float32Array(analizador.fftSize);
    const trozos = [];
    grabador.ondataavailable = (e) => { if (e.data && e.data.size) trozos.push(e.data); };

    this.activa = true;
    const inicio = performance.now();
    let ruidoFondo = 0, medidasRuido = 0;
    let umbral = 0.02;
    let tiempoVoz = 0;           // ms acumulados por encima del umbral
    let hablado = false;
    let inicioSilencio = null;
    let ultimo = performance.now();

    return new Promise((resolver) => {
      let cancelada = false;
      const terminar = (cancelar = false) => {
        if (!this.activa) return;
        this.activa = false;
        cancelada = cancelar;
        clearInterval(bucle);
        alNivel(0);
        if (grabador.state !== 'inactive') grabador.stop(); else alParar();
      };
      const alParar = () => {
        stream.getTracks().forEach((t) => t.stop());
        ctx.close().catch(() => {});
        const tipo = grabador.mimeType || mime || 'audio/webm';
        resolver({
          blob: cancelada || !hablado ? null : new Blob(trozos, { type: tipo }),
          mime: tipo,
          hablado,
          cancelada,
          segundos: (performance.now() - inicio) / 1000,
        });
      };
      grabador.onstop = alParar;
      this._fin = terminar;

      // Cada 50 ms: medimos el volumen y decidimos si cortar.
      const bucle = setInterval(() => {
        const ahora = performance.now();
        const dt = ahora - ultimo;
        ultimo = ahora;
        analizador.getFloatTimeDomainData(muestras);
        const nivel = rms(muestras);
        alNivel(Math.min(1, nivel * 8));
        const transcurrido = ahora - inicio;

        // Los primeros 300 ms sirven para medir el ruido de fondo.
        if (transcurrido < 300) {
          ruidoFondo += nivel; medidasRuido++;
          umbral = Math.max(0.015, (ruidoFondo / medidasRuido) * 3);
          return;
        }
        if (nivel > umbral) {
          tiempoVoz += dt;
          if (tiempoVoz > 150) hablado = true;
          inicioSilencio = null;
        } else if (hablado) {
          inicioSilencio = inicioSilencio || ahora;
          if (ahora - inicioSilencio >= silencio * 1000) terminar();
        }
        if (!hablado && transcurrido > esperaInicial * 1000) terminar();
        if (transcurrido > maximo * 1000) terminar();
      }, 50);

      grabador.start(250);
    });
  }

  // Termina la grabación y la envía (p. ej. al soltar Ctrl+Espacio).
  detener() { if (this._fin) this._fin(false); }
  // Termina y descarta lo grabado (Esc).
  cancelar() { if (this._fin) this._fin(true); }
}

// ---------------------------------------------------------------------------
// Reproductor de la voz de Jarvis (mp3 en base64 que devuelve n8n)
// ---------------------------------------------------------------------------
class Reproductor {
  constructor() {
    this.ctx = null;
    this.fuente = null;
    this.sonando = false;
    this._fin = null;
  }

  _contexto() {
    if (!this.ctx || this.ctx.state === 'closed') this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /** Reproduce y resuelve cuando termina (o cuando se para). */
  async reproducir(base64, { volumen = 0.9, alNivel = () => {} } = {}) {
    this.parar();
    const ctx = this._contexto();
    const binario = atob(base64);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    let buffer;
    try {
      buffer = await ctx.decodeAudioData(bytes.buffer);
    } catch (e) {
      throw new Error('No se pudo reproducir el audio de Jarvis (formato no válido)');
    }

    const fuente = ctx.createBufferSource();
    const ganancia = ctx.createGain();
    const analizador = ctx.createAnalyser();
    analizador.fftSize = 1024;
    fuente.buffer = buffer;
    ganancia.gain.value = volumen;
    // El analizador va ANTES del volumen: el núcleo late igual aunque bajes el volumen.
    fuente.connect(analizador);
    analizador.connect(ganancia);
    ganancia.connect(ctx.destination);
    const muestras = new Float32Array(analizador.fftSize);

    this.fuente = fuente;
    this.sonando = true;
    return new Promise((resolver) => {
      const bucle = setInterval(() => {
        analizador.getFloatTimeDomainData(muestras);
        alNivel(Math.min(1, rms(muestras) * 5));
      }, 33);
      const terminar = () => {
        if (!this.sonando || this.fuente !== fuente) return resolver();
        clearInterval(bucle);
        this.sonando = false;
        this.fuente = null;
        this._fin = null;
        alNivel(0);
        resolver();
      };
      this._fin = terminar;
      fuente.onended = terminar;
      fuente.start();
    });
  }

  parar() {
    if (this.fuente) {
      try { this.fuente.stop(); } catch (_) {}
    }
    if (this._fin) this._fin();
  }
}

// ---------------------------------------------------------------------------
// Pitidos cortos (empezar / terminar de escuchar)
// ---------------------------------------------------------------------------
const Pitidos = {
  ctx: null,
  _tono(frecuencias, volumen = 0.25) {
    try {
      if (!this.ctx || this.ctx.state === 'closed') this.ctx = new AudioContext();
      const ctx = this.ctx;
      const t = ctx.currentTime;
      frecuencias.forEach((f, i) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = f;
        const ini = t + i * 0.09;
        g.gain.setValueAtTime(0.0001, ini);
        g.gain.exponentialRampToValueAtTime(volumen, ini + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, ini + 0.12);
        osc.connect(g).connect(ctx.destination);
        osc.start(ini);
        osc.stop(ini + 0.13);
      });
    } catch (_) { /* sin audio: no pasa nada */ }
  },
  empezar(volumen) { this._tono([660, 990], 0.22 * (volumen ?? 1)); },
  terminar(volumen) { this._tono([880, 520], 0.18 * (volumen ?? 1)); },
};

// ---------------------------------------------------------------------------
// Vosk (local): modelo compartido, transcripción de respaldo y activación
// ---------------------------------------------------------------------------
const Vosk = {
  modelo: null,
  cargando: null,
  cargar() {
    if (this.modelo) return Promise.resolve(this.modelo);
    if (!this.cargando) {
      this.cargando = window.Vosk.createModel(URL_MODELO, -1) // -1 = sin mensajes de depuración
        .then((m) => (this.modelo = m))
        .catch((e) => {
          this.cargando = null;
          throw new Error('No se pudo cargar el modelo de voz local: ' + (e && e.message ? e.message : e));
        });
    }
    return this.cargando;
  },

  /** Transcribe localmente (solo español) un audio ya grabado. Respaldo sin conexión. */
  async transcribir(blob, gramatica) {
    const modelo = await this.cargar();
    const ctx = new OfflineAudioContext(1, 16000, 16000);
    let audio;
    try {
      audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    } catch (_) {
      throw new Error('No se pudo leer la grabación para el respaldo local');
    }
    // Pasamos a 16 kHz mono, que es lo que mejor entiende el modelo.
    const offline = new OfflineAudioContext(1, Math.ceil(audio.duration * 16000), 16000);
    const f = offline.createBufferSource();
    f.buffer = audio;
    f.connect(offline.destination);
    f.start();
    const remuestreado = await offline.startRendering();
    const datos = remuestreado.getChannelData(0);

    const rec = gramatica ? new modelo.KaldiRecognizer(16000, gramatica) : new modelo.KaldiRecognizer(16000);
    return new Promise((resolver) => {
      let partes = [];
      const limite = setTimeout(() => fin(), 15000);
      const fin = () => { clearTimeout(limite); try { rec.remove(); } catch (_) {} resolver(partes.join(' ').trim()); };
      rec.on('result', (m) => {
        const t = m.result && m.result.text;
        if (t) partes.push(t);
      });
      // Trozos de 0,25 s; luego medio segundo de silencio para cerrar la frase.
      for (let i = 0; i < datos.length; i += 4000) rec.acceptWaveformFloat(datos.subarray(i, i + 4000), 16000);
      rec.acceptWaveformFloat(new Float32Array(8000), 16000);
      rec.retrieveFinalResult();
      // El resultado final llega por el evento "result"; damos un margen.
      setTimeout(fin, 1500);
    });
  },
};

/**
 * Palabra de activación "Jarvis": escucha continuamente EN LOCAL (nada sale del PC).
 * Cuando la oye llama a alOir(). Se pausa mientras grabas o mientras Jarvis habla.
 */
class Activacion {
  constructor(alOir) {
    this.alOir = alOir;
    this.encendida = false;
    this._recursos = null;
  }

  async encender() {
    if (this.encendida) return;
    this.encendida = true;
    try {
      await this._abrir();
    } catch (e) {
      this.encendida = false;
      throw e;
    }
  }

  apagar() {
    this.encendida = false;
    this._cerrar();
  }

  // Pausa temporal (sin cambiar si está encendida o no).
  pausar() { this._cerrar(); }
  async reanudar() { if (this.encendida && !this._recursos) await this._abrir(); }

  async _abrir() {
    const modelo = await Vosk.cargar();
    if (!this.encendida || this._recursos) return;
    const stream = await abrirMicrofono();
    if (!this.encendida) { stream.getTracks().forEach((t) => t.stop()); return; }
    const ctx = new AudioContext();
    const fuente = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const rec = new modelo.KaldiRecognizer(ctx.sampleRate, GRAMATICA_ACTIVACION);
    let disparado = false;
    const revisar = (texto) => {
      if (disparado || !texto || !PATRON_ACTIVACION.test(texto)) return;
      disparado = true;
      this._cerrar();
      this.alOir(texto);
    };
    // Solo resultados finales: más fiable que los parciales (menos falsas alarmas).
    rec.on('result', (m) => revisar(m.result && m.result.text));
    proc.onaudioprocess = (ev) => { try { rec.acceptWaveform(ev.inputBuffer); } catch (_) {} };
    fuente.connect(proc);
    proc.connect(ctx.destination);
    this._recursos = { stream, ctx, fuente, proc, rec };
  }

  _cerrar() {
    const r = this._recursos;
    if (!r) return;
    this._recursos = null;
    try { r.proc.disconnect(); r.fuente.disconnect(); } catch (_) {}
    r.stream.getTracks().forEach((t) => t.stop());
    r.ctx.close().catch(() => {});
    try { r.rec.remove(); } catch (_) {}
  }
}

// ---------------------------------------------------------------------------
// Vigilante: mientras Jarvis habla, escucha el micro; si empiezas a hablar
// (por encima del ruido durante 300 ms) avisa para cortarle e ir a escucharte.
// El micro se abre con cancelación de eco para no confundir su propia voz.
// ---------------------------------------------------------------------------
class Vigilante {
  constructor() { this._r = null; }

  async iniciar(alInterrumpir, { sensibilidad = 4 } = {}) {
    this.parar();
    const stream = await abrirMicrofono();
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(an);
    const m = new Float32Array(an.fftSize);
    let fondo = 0, n = 0, porEncima = 0;
    const inicio = performance.now();
    const bucle = setInterval(() => {
      an.getFloatTimeDomainData(m);
      const v = rms(m);
      if (performance.now() - inicio < 400) { fondo += v; n++; return; }
      const umbral = Math.max(0.045, (fondo / Math.max(1, n)) * sensibilidad);
      porEncima = v > umbral ? porEncima + 50 : Math.max(0, porEncima - 25);
      if (porEncima >= 300) { this.parar(); alInterrumpir(); }
    }, 50);
    this._r = { stream, ctx, bucle };
  }

  parar() {
    const r = this._r;
    if (!r) return;
    this._r = null;
    clearInterval(r.bucle);
    r.stream.getTracks().forEach((t) => t.stop());
    r.ctx.close().catch(() => {});
  }
}

// Escucha "sí" o "no" EN LOCAL (Vosk con gramática cerrada) para confirmar acciones.
const GRAMATICA_SI_NO = JSON.stringify(['sí', 'si', 'no', 'vale', 'confirmo', 'adelante', 'cancela', 'cancelar', '[unk]']);
async function escucharSiNo(segundos = 8) {
  const modelo = await Vosk.cargar();
  const stream = await abrirMicrofono();
  const ctx = new AudioContext();
  const fuente = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const rec = new modelo.KaldiRecognizer(ctx.sampleRate, GRAMATICA_SI_NO);
  return new Promise((resolver) => {
    let fin = false;
    const terminar = (r) => {
      if (fin) return;
      fin = true;
      clearTimeout(t);
      try { proc.disconnect(); fuente.disconnect(); } catch (_) {}
      stream.getTracks().forEach((x) => x.stop());
      ctx.close().catch(() => {});
      try { rec.remove(); } catch (_) {}
      resolver(r);
    };
    rec.on('result', (msg) => {
      const tx = (msg.result && msg.result.text) || '';
      // Sin \b: no funciona con letras acentuadas como la "í" de "sí".
      const palabras = tx.split(/\s+/);
      if (palabras.some((p) => ['no', 'cancela', 'cancelar'].includes(p))) terminar('no');
      else if (palabras.some((p) => ['sí', 'si', 'vale', 'confirmo', 'adelante'].includes(p))) terminar('si');
    });
    proc.onaudioprocess = (ev) => { try { rec.acceptWaveform(ev.inputBuffer); } catch (_) {} };
    fuente.connect(proc);
    proc.connect(ctx.destination);
    const t = setTimeout(() => terminar(null), segundos * 1000);
  });
}

// ---------------------------------------------------------------------------
// Boca de respaldo: voz de Windows (solo si n8n no devuelve audio)
// ---------------------------------------------------------------------------
class Boca {
  constructor(idioma = 'es-ES') {
    this.idioma = idioma;
    this.voces = [];
    this.hablando = false;
    const cargarVoces = () => { this.voces = speechSynthesis.getVoices(); };
    cargarVoces();
    speechSynthesis.addEventListener('voiceschanged', cargarVoces);
  }

  vocesEspanol() {
    return this.voces.filter((v) => v.lang && v.lang.toLowerCase().startsWith('es'));
  }

  // Elige voz según el idioma del texto (árabe/francés si hay), si no, español.
  elegirVoz(nombre, texto = '') {
    const idioma = /[؀-ۿ]/.test(texto) ? 'ar' : /\b(je|vous|est|merci|bonjour|avec)\b/i.test(texto) ? 'fr' : 'es';
    const delIdioma = this.voces.filter((v) => v.lang && v.lang.toLowerCase().startsWith(idioma));
    if (idioma !== 'es' && delIdioma.length) return delIdioma[0];
    const es = this.vocesEspanol();
    return es.find((v) => v.name === nombre) || es.find((v) => v.lang === this.idioma) || es[0] || null;
  }

  hablar(texto, { volumen = 0.9, nombreVoz = '', alNivel = () => {} } = {}) {
    this.callar();
    const limpio = limpiarParaVoz(texto);
    if (!limpio) return Promise.resolve();
    return new Promise((resolver) => {
      // Se trocea en frases: la voz de Windows corta los textos muy largos.
      const trozos = limpio.match(/[^.!?\n]+[.!?]*|\n+/g)?.map((t) => t.trim()).filter(Boolean) || [limpio];
      const voz = this.elegirVoz(nombreVoz, limpio);
      let pendientes = trozos.length;
      const turno = (this._turno = (this._turno || 0) + 1);
      let acabado = false;
      this.hablando = true;
      // speechSynthesis no da el audio real: amplitud simulada para el núcleo.
      const animacion = setInterval(() => alNivel(0.35 + Math.random() * 0.65), 90);
      const terminar = () => {
        if (acabado) return;
        acabado = true;
        clearInterval(animacion);
        this.hablando = false;
        alNivel(0);
        resolver();
      };
      for (const trozo of trozos) {
        const u = new SpeechSynthesisUtterance(trozo);
        u.lang = (voz && voz.lang) || this.idioma;
        if (voz) u.voice = voz;
        u.volume = volumen;
        u.rate = 1.03;
        u.onend = u.onerror = () => { if (--pendientes <= 0) terminar(); };
        speechSynthesis.speak(u);
      }
      this._terminar = terminar;
      // Sin voces instaladas speechSynthesis puede no avisar nunca: salvaguardas.
      setTimeout(() => { if (this._turno === turno && !speechSynthesis.speaking && !speechSynthesis.pending) terminar(); }, 1500);
      setTimeout(() => { if (this._turno === turno && !acabado) { speechSynthesis.cancel(); terminar(); } }, 5000 + limpio.length * 110);
    });
  }

  callar() {
    speechSynthesis.cancel();
    if (this._terminar) this._terminar();
  }
}

// Quita símbolos de formato (markdown, enlaces, emojis) para que suene natural.
function limpiarParaVoz(texto) {
  return String(texto || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/g, 'enlace')
    .replace(/[*_#`>|~]/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

window.VozJarvis = { Grabadora, Reproductor, Pitidos, Vosk, Activacion, Vigilante, escucharSiNo, Boca, limpiarParaVoz, PATRON_ACTIVACION, abrirMicrofono, rms };
})();
