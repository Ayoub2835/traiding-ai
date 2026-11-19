# ACTUALIZAR-JARVIS.ps1 — descarga la última versión de Jarvis y la instala.
# Uso (en PowerShell, sin permisos de administrador):
#   irm https://raw.githubusercontent.com/ayoub2835/traiding-ai/claude/lucid-hawking-kithaj/ACTUALIZAR-JARVIS.ps1 | iex
# Qué hace:
#   1. Descarga la rama claude/lucid-hawking-kithaj de GitHub (ZIP).
#   2. La deja en Documentos\Jarvis-app (sustituye el código; no toca tus ajustes,
#      claves ni memoria, que están en %APPDATA%\Jarvis).
#   3. Si tienes importado-n8n.json en Descargas, lo copia a la carpeta memoria.
#   4. Ejecuta INSTALAR-JARVIS.bat (comprueba Node y Ollama, compila e instala).
#   5. Abre las páginas para crear tus claves gratis de Gemini y de Gmail.
$ErrorActionPreference = 'Stop'
try {
  $rama = 'claude/lucid-hawking-kithaj'
  $url = "https://github.com/ayoub2835/traiding-ai/archive/refs/heads/$rama.zip"
  $docs = [Environment]::GetFolderPath('MyDocuments')
  $destino = Join-Path $docs 'Jarvis-app'
  $tmp = Join-Path $env:TEMP ('jarvis-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null

  Write-Host "`n  [1/5] Descargando Jarvis..." -ForegroundColor Cyan
  $zip = Join-Path $tmp 'jarvis.zip'
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing

  Write-Host "  [2/5] Descomprimiendo en $destino..." -ForegroundColor Cyan
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $carpeta = Get-ChildItem -Path $tmp -Directory | Where-Object { $_.Name -like 'traiding-ai-*' } | Select-Object -First 1
  if (-not $carpeta) { throw 'El ZIP no tiene la carpeta esperada' }
  New-Item -ItemType Directory -Path $destino -Force | Out-Null
  # Se conservan node_modules y dist si ya estaban (instalación más rápida).
  Copy-Item -Path (Join-Path $carpeta.FullName '*') -Destination $destino -Recurse -Force

  Write-Host "  [3/5] Buscando tu memoria de n8n..." -ForegroundColor Cyan
  $descargas = Join-Path $env:USERPROFILE 'Downloads'
  $memoria = Join-Path $descargas 'importado-n8n.json'
  if (Test-Path $memoria) {
    New-Item -ItemType Directory -Path (Join-Path $destino 'memoria') -Force | Out-Null
    Copy-Item -Path $memoria -Destination (Join-Path $destino 'memoria\importado-n8n.json') -Force
    Write-Host '        Memoria encontrada: Jarvis la importará al abrirse.'
  } else {
    Write-Host '        No está en Descargas (puedes importarla luego en Ajustes).'
  }
  Remove-Item -Path $tmp -Recurse -Force

  Write-Host "  [4/5] Instalando (INSTALAR-JARVIS.bat)..." -ForegroundColor Cyan
  $bat = Join-Path $destino 'INSTALAR-JARVIS.bat'
  $p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "`"$bat`"" -WorkingDirectory $destino -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "El instalador terminó con error ($($p.ExitCode)). Mira la ventana del instalador." }

  Write-Host "  [5/5] Abriendo las páginas para tus claves gratis..." -ForegroundColor Cyan
  Start-Process 'https://aistudio.google.com/apikey'
  Start-Process 'https://myaccount.google.com/apppasswords'
  Write-Host "`n  Listo. Pega las claves en Jarvis: Ajustes -> Claves y servicios -> Probar." -ForegroundColor Green
  Write-Host "  Al abrir Jarvis te preguntará si programa el informe y la caza en Windows: di que sí.`n" -ForegroundColor Green
} catch {
  Write-Host "`n  Algo ha fallado: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "  Haz una foto de esta ventana y envíamela.`n" -ForegroundColor Red
}
