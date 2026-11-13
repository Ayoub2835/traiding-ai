// Conversación por voz en TIEMPO REAL (si tienes clave de OpenAI o Gemini).
//  - OpenAI Realtime: WebRTC directo desde esta ventana con una clave EFÍMERA
//    que pide el proceso principal (tu clave real nunca llega aquí).
//  - Gemini Live: el WebSocket va por el proceso principal; aquí solo se manda
//    el audio del micro (PCM 16 kHz) y se reproduce el de Jarvis (PCM 24 kHz).
// En los dos, puedes interrumpir a Jarvis hablando: el servidor lo detecta solo.
// Para tareas, memoria, correos, habilidades… el modelo llama a "pedir_a_jarvis",
// que pasa por el router de Jarvis (cerebro) y sus permisos.
(() => {
'use strict';
const api = window.jarvis;
const { abrirMicrofono, rms } = window.VozJarvis;

class TiempoReal {
  /**
   * @param {{alNivel:(n:number)=>void, alTexto:(rol:string,texto:string)=>void, alEstado:(e:string)=>void, alHerramienta:(r:object)=>void, alFin:(motivo:string)=>void}} cb
   */
  constructor(cb) {
    this.cb = cb;
    this.activo = false;
    this.tipo = null;
    this._r = {};
    this._ultimaActividad = 0;
  }

  async iniciar(tipo) {
    if (this.activo) this.parar('reinicio');
    this.tipo = tipo;
    this.activo = true;
    this._ultimaActividad = Date.now();
    // Cierre automático si nadie habla en 60 s (el tiempo real cuesta dinero).
    this._r.inactivo = setInterval(() => {
      if (Date.now() - this._ultimaActividad > 60000) this.parar('inactividad');
    }, 5000);
    try {
      if (tipo === 'realtime-openai') await this._openai();
      else await this._gemini();
    } catch (e) {
      this.parar('error');
      throw e;
    }
  }

  _actividad() { this._ultimaActividad = Date.now(); }

  // Nivel del audio remoto (voz de Jarvis) para el núcleo LED.
  _medir(stream) {
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(an);
    const m = new Float32Array(an.fftSize);
    this._r.ctxNivel = ctx;
    this._r.nivel = setInterval(() => { an.getFloatTimeDomainData(m); this.cb.alNivel(Math.min(1, rms(m) * 5)); }, 40);
  }

  // ---------------- OpenAI Realtime (WebRTC) ----------------
  async _openai() {
    const s = await api.llamar('voz.sesionOpenAI');
    if (!s.ok) throw new Error(s.error);
    const pc = new RTCPeerConnection();
    this._r.pc = pc;
    const audio = new Audio();
    audio.autoplay = true;
    this._r.audio = audio;
    pc.ontrack = (e) => { audio.srcObject = e.streams[0]; this._medir(e.streams[0]); };
    const mic = await abrirMicrofono();
    this._r.mic = mic;
    pc.addTrack(mic.getTracks()[0], mic);
    const dc = pc.createDataChannel('oai-events');
    this._r.dc = dc;
    dc.onmessage = (e) => this._eventoOpenAI(JSON.parse(e.data));
    const oferta = await pc.createOffer();
    await pc.setLocalDescription(oferta);
    const resp = await fetch(`${s.url}?model=${encodeURIComponent(s.modelo)}`, {
      method: 'POST', body: oferta.sdp, headers: { Authorization: `Bearer ${s.clave}`, 'Content-Type': 'application/sdp' },
    });
    if (!resp.ok) throw new Error(`OpenAI Realtime: HTTP ${resp.status}`);
    await pc.setRemoteDescription({ type: 'answer', sdp: await resp.text() });
    this.cb.alEstado('ESCUCHANDO (TIEMPO REAL)');
  }

  async _eventoOpenAI(ev) {
    this._actividad();
    switch (ev.type) {
      case 'input_audio_buffer.speech_started': this.cb.alEstado('ESCUCHANDO…'); break;
      case 'input_audio_buffer.speech_stopped': this.cb.alEstado('PROCESANDO…'); break;
      case 'response.output_audio.delta': case 'response.audio.delta': this.cb.alEstado('HABLANDO'); break;
      case 'conversation.item.input_audio_transcription.completed': if (ev.transcript) this.cb.alTexto('yo', ev.transcript.trim()); break;
      case 'response.output_audio_transcript.done': case 'response.audio_transcript.done': if (ev.transcript) this.cb.alTexto('jarvis', ev.transcript.trim()); break;
      case 'response.done': this.cb.alEstado('ESCUCHANDO (TIEMPO REAL)'); break;
      case 'response.function_call_arguments.done': {
        let args = {};
        try { args = JSON.parse(ev.arguments || '{}'); } catch (_) { /* vacío */ }
        this.cb.alEstado('PROCESANDO…');
        const r = await api.llamar('cerebro.responder', args.peticion || '', 'voz-tiempo-real');
        this.cb.alHerramienta(r);
        const salida = r.ok ? `${r.texto} (contestó: ${r.motor})` : `No he podido: ${r.error}`;
        this._enviar({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: ev.call_id, output: salida } });
        this._enviar({ type: 'response.create' });
        break;
      }
      case 'error': this.cb.alTexto('error', `Tiempo real: ${ev.error?.message || 'error'}`); break;
      default: break;
    }
  }

  _enviar(o) { if (this._r.dc && this._r.dc.readyState === 'open') this._r.dc.send(JSON.stringify(o)); }

  // ---------------- Gemini Live ----------------
  async _gemini() {
    const s = await api.llamar('voz.geminiAbrir');
    if (!s.ok) throw new Error(s.error);
    this._r.geminiId = s.id;
    // Reproducción: PCM 24 kHz en cola; se corta si Gemini avisa de interrupción.
    const salida = new AudioContext({ sampleRate: 24000 });
    const an = salida.createAnalyser();
    an.connect(salida.destination);
    this._r.salida = salida;
    this._r.fuentes = new Set();
    let siguiente = 0;
    const m = new Float32Array(1024);
    this._r.nivel = setInterval(() => { an.getFloatTimeDomainData(m); this.cb.alNivel(Math.min(1, rms(m) * 5)); }, 40);
    this._r.quitar = api.alEvento(({ tipo, datos }) => {
      if (tipo !== 'gemini' || datos.id !== s.id) return;
      this._actividad();
      if (datos.ev === 'audio') {
        const bytes = Uint8Array.from(atob(datos.d), (c) => c.charCodeAt(0));
        const pcm = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
        const buf = salida.createBuffer(1, pcm.length, 24000);
        const canal = buf.getChannelData(0);
        for (let i = 0; i < pcm.length; i++) canal[i] = pcm[i] / 32768;
        const f = salida.createBufferSource();
        f.buffer = buf;
        f.connect(an);
        siguiente = Math.max(siguiente, salida.currentTime + 0.02);
        f.start(siguiente);
        siguiente += buf.duration;
        this._r.fuentes.add(f);
        f.onended = () => this._r.fuentes.delete(f);
        this.cb.alEstado('HABLANDO');
      } else if (datos.ev === 'interrumpido') {
        for (const f of this._r.fuentes) { try { f.stop(); } catch (_) {} }
        this._r.fuentes.clear();
        siguiente = 0;
        this.cb.alEstado('ESCUCHANDO…');
      } else if (datos.ev === 'texto') {
        this._acumular(datos.d.rol, datos.d.texto);
      } else if (datos.ev === 'fin_turno') {
        this._volcar();
        this.cb.alEstado('ESCUCHANDO (TIEMPO REAL)');
      } else if (datos.ev === 'cerrada' || datos.ev === 'error') {
        this.parar(datos.d?.motivo || datos.d?.error || 'cerrada');
      }
    });
    // Micro: PCM 16 bits a 16 kHz, en trozos de ~128 ms.
    const mic = await abrirMicrofono();
    this._r.mic = mic;
    const entrada = new AudioContext({ sampleRate: 16000 });
    this._r.entrada = entrada;
    const proc = entrada.createScriptProcessor(2048, 1, 1);
    entrada.createMediaStreamSource(mic).connect(proc);
    proc.connect(entrada.destination);
    proc.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0);
      const pcm = new Int16Array(d.length);
      for (let i = 0; i < d.length; i++) pcm[i] = Math.max(-1, Math.min(1, d[i])) * 32767;
      let bin = '';
      const b = new Uint8Array(pcm.buffer);
      for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
      api.llamar('voz.geminiAudio', s.id, btoa(bin));
    };
    this.cb.alEstado('ESCUCHANDO (TIEMPO REAL)');
  }

  // Gemini manda la transcripción a trozos: se junta hasta el fin del turno.
  _acumular(rol, t) { this._texto = this._texto || { yo: '', jarvis: '' }; this._texto[rol] += t; }
  _volcar() {
    if (!this._texto) return;
    if (this._texto.yo.trim()) this.cb.alTexto('yo', this._texto.yo.trim());
    if (this._texto.jarvis.trim()) this.cb.alTexto('jarvis', this._texto.jarvis.trim());
    this._texto = null;
  }

  parar(motivo = 'parado') {
    if (!this.activo) return;
    this.activo = false;
    const r = this._r;
    this._r = {};
    clearInterval(r.inactivo);
    clearInterval(r.nivel);
    try { r.dc && r.dc.close(); } catch (_) {}
    try { r.pc && r.pc.close(); } catch (_) {}
    if (r.audio) r.audio.srcObject = null;
    r.mic && r.mic.getTracks().forEach((t) => t.stop());
    for (const c of [r.ctxNivel, r.salida, r.entrada]) c && c.close().catch(() => {});
    if (r.quitar) r.quitar();
    if (r.geminiId) api.llamar('voz.geminiCerrar', r.geminiId);
    this._volcar();
    this.cb.alNivel(0);
    this.cb.alFin(motivo);
  }
}

window.TiempoReal = TiempoReal;
})();
