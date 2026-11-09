// Descarga el modelo de reconocimiento de voz en español (Vosk, ~40 MB)
// y lo empaqueta como .tar.gz, que es el formato que entiende vosk-browser.
// El reconocimiento se hace 100 % en el PC: el audio nunca sale de tu ordenador.
// Solo hace falta ejecutarlo una vez:  npm run modelo
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const tar = require('tar');

const NOMBRE = 'vosk-model-small-es-0.42';
const URL_MODELO = `https://alphacephei.com/vosk/models/${NOMBRE}.zip`;
const CARPETA = path.join(__dirname, '..', 'modelo');
const DESTINO = path.join(CARPETA, 'modelo-es.tar.gz');

async function main() {
  if (fs.existsSync(DESTINO)) {
    console.log('El modelo ya está preparado:', DESTINO);
    return;
  }
  fs.mkdirSync(CARPETA, { recursive: true });
  const zipRuta = path.join(CARPETA, `${NOMBRE}.zip`);

  if (!fs.existsSync(zipRuta)) {
    console.log('Descargando modelo de voz en español…', URL_MODELO);
    const resp = await fetch(URL_MODELO);
    if (!resp.ok) throw new Error(`No se pudo descargar el modelo (HTTP ${resp.status})`);
    fs.writeFileSync(zipRuta, Buffer.from(await resp.arrayBuffer()));
  }

  console.log('Descomprimiendo…');
  const temp = path.join(CARPETA, 'tmp');
  fs.rmSync(temp, { recursive: true, force: true });
  new AdmZip(zipRuta).extractAllTo(temp, true);

  console.log('Empaquetando como .tar.gz…');
  await tar.c({ gzip: true, file: DESTINO, cwd: temp }, [NOMBRE]);

  fs.rmSync(temp, { recursive: true, force: true });
  fs.rmSync(zipRuta, { force: true });
  console.log('Modelo listo:', DESTINO);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
