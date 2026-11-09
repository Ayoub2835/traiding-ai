// Voz de Jarvis:
//  - OÍDO: reconocimiento de voz en español 100 % local con Vosk (WebAssembly).
//    El audio del micrófono nunca sale del PC.
//  - BOCA: síntesis de voz con las voces instaladas en Windows (speechSynthesis).
'use strict';

const URL_MODELO = 'jarvis://app/modelo/modelo-es.tar.gz';

class Oido {
  constructor() {
    this.modelo = null;
    this.cargando = null;
    this.escuchando = false;
    this._cancelar = null;
  }

  // Carga el modelo una sola vez (tarda unos segundos la primera vez).
  cargar() {
    if (this.modelo) return Promise.resolve(this.modelo);
    if (!this.cargando) {
      this.cargando = window.Vosk.createModel(URL_MODELO, -1) // -1 = sin mensajes de depuración
        .then((m) => (this.modelo = m))
        .catch((e) => {
          this.cargando = null;
          throw new Error('No se pudo cargar el modelo de voz: ' + (e && e.message ? e.message : e));
        });
    }
    return this.cargando;
  }

  /**
   * Escucha UNA frase. Devuelve el texto reconocido, o '' si no se dijo nada.
   * @param {object} o
   * @param {(t:string)=>void} o.alParcial  texto provisional mientras hablas
   * @param {(n:number)=>void} o.alNivel    volumen del micro 0..1 (para las luces)
   * @param {number} o.esperaInicial        segundos máximos sin que empieces a hablar
   * @param {number} o.maximo               segundos máximos de frase
   */
  async escuchar({ alParcial = () => {}, alNivel = () => {}, esperaInicial = 8, maximo = 25 } = {}) {
    if (this.escuchando) this.detener();
    const modelo = await this.cargar();

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
        video: false,
      });
    } catch (e) {
      throw new Error('No se pudo usar el micrófono: ' + (e.message || e.name) +
        '. Revisa Configuración de Windows → Privacidad → Micrófono.');
    }

    this.escuchando = true;
    const ctx = new AudioContext();
    const fuente = ctx.createMediaStreamSource(stream);
    const procesador = ctx.createScriptProcessor(4096, 1, 1);
    const reconocedor = new modelo.KaldiRecognizer(ctx.sampleRate);

    return new Promise((resolver) => {
      let terminado = false;
      let hablado = false;
      let ultimoParcial = '';

      const fin = (texto) => {
        if (terminado) return;
        terminado = true;
        this.escuchando = false;
        this._cancelar = null;
        clearTimeout(tEspera);
        clearTimeout(tMaximo);
        try { procesador.disconnect(); fuente.disconnect(); } catch (_) {}
        stream.getTracks().forEach((t) => t.stop());
        ctx.close().catch(() => {});
        try { reconocedor.remove(); } catch (_) {}
        alNivel(0);
        resolver((texto || '').trim());
      };

      reconocedor.on('partialresult', (m) => {
        const p = (m.result && m.result.partial) || '';
        if (p && p !== ultimoParcial) {
          ultimoParcial = p;
          hablado = true;
          clearTimeout(tEspera);
          alParcial(p);
        }
      });
      // Vosk emite "result" cuando detecta un silencio tras la frase.
      reconocedor.on('result', (m) => {
        const t = (m.result && m.result.text) || '';
        if (t) fin(t);
      });

      procesador.onaudioprocess = (ev) => {
        if (terminado) return;
        const datos = ev.inputBuffer.getChannelData(0);
        let suma = 0;
        for (let i = 0; i < datos.length; i += 16) suma += datos[i] * datos[i];
        alNivel(Math.min(1, Math.sqrt(suma / (datos.length / 16)) * 6));
        try { reconocedor.acceptWaveform(ev.inputBuffer); } catch (_) {}
      };
      fuente.connect(procesador);
      procesador.connect(ctx.destination);

      // Si no empiezas a hablar en X segundos, se deja de escuchar.
      const tEspera = setTimeout(() => { if (!hablado) fin(''); }, esperaInicial * 1000);
      // Límite de seguridad: se usa lo último que se entendió.
      const tMaximo = setTimeout(() => fin(ultimoParcial), maximo * 1000);
      this._cancelar = () => fin('');
    });
  }

  detener() {
    if (this._cancelar) this._cancelar();
  }
}

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

  elegirVoz(nombre) {
    const es = this.vocesEspanol();
    return es.find((v) => v.name === nombre)
      || es.find((v) => v.lang === this.idioma)
      || es[0]
      || null;
  }

  /**
   * Lee un texto en voz alta. Resuelve cuando termina (o enseguida si no hay voz).
   * alNivel recibe una "amplitud" aproximada para animar el núcleo.
   */
  hablar(texto, { volumen = 0.9, nombreVoz = '', alNivel = () => {} } = {}) {
    this.callar();
    const limpio = limpiarParaVoz(texto);
    if (!limpio) return Promise.resolve();
    return new Promise((resolver) => {
      // Se trocea en frases: la voz de Windows corta los textos muy largos.
      const trozos = limpio.match(/[^.!?\n]+[.!?]*|\n+/g)?.map((t) => t.trim()).filter(Boolean) || [limpio];
      const voz = this.elegirVoz(nombreVoz);
      let pendientes = trozos.length;
      let animacion = null;
      const turno = (this._turno = (this._turno || 0) + 1); // identifica esta locución
      this.hablando = true;

      let acabado = false;
      const terminar = () => {
        if (acabado) return;
        acabado = true;
        clearInterval(animacion);
        this.hablando = false;
        alNivel(0);
        resolver();
      };
      // Amplitud simulada mientras habla (speechSynthesis no da el audio real).
      animacion = setInterval(() => alNivel(0.35 + Math.random() * 0.65), 90);

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
      // Si no hay ninguna voz instalada, speechSynthesis puede no avisar nunca.
      setTimeout(() => { if (this._turno === turno && !speechSynthesis.speaking && !speechSynthesis.pending) terminar(); }, 1500);
      // Salvaguarda: algunos motores de voz no disparan "onend". Tiempo máximo
      // generoso según la longitud del texto, para que Jarvis nunca se quede colgado.
      const maximo = 5000 + limpio.length * 110;
      setTimeout(() => { if (this._turno === turno && !acabado) { speechSynthesis.cancel(); terminar(); } }, maximo);
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
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

window.VozJarvis = { Oido, Boca, limpiarParaVoz };
