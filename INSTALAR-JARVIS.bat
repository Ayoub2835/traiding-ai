@echo off
rem ==========================================================================
rem  INSTALAR-JARVIS.bat  (Jarvis v2)
rem  1) Comprueba Node.js
rem  2) Comprueba Ollama y descarga el modelo local si falta (pregunta antes)
rem  3) Instala Claude Code (las "manos") si falta (pregunta antes)
rem  4) npm install
rem  5) npm run compilar (descarga el modelo de voz y crea el instalador)
rem  6) Abre dist\Jarvis-Setup-*.exe para instalar
rem ==========================================================================
chcp 65001 >nul
setlocal
title Instalar Jarvis v2
cd /d "%~dp0"
set "MODELO_LOCAL=qwen2.5:3b"

echo.
echo  ============================================
echo     J.A.R.V.I.S. v2  -  Instalacion
echo  ============================================
echo.

rem --- 1. Node.js -----------------------------------------------------------
echo  [1/6] Comprobando Node.js...
set "NODE_MAYOR=0"
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node" 2^>nul') do set "NODE_MAYOR=%%v"
if "%NODE_MAYOR%"=="0" (
  echo.
  echo  No tienes Node.js instalado.
  echo  Descargalo de https://nodejs.org  ^(version LTS^), instalalo
  echo  y vuelve a hacer doble clic en este archivo.
  goto :error
)
if %NODE_MAYOR% LSS 18 (
  echo  Tu Node.js es muy antiguo ^(version %NODE_MAYOR%^). Instala la version LTS de https://nodejs.org
  goto :error
)
echo        Node.js OK ^(version %NODE_MAYOR%^)
echo.

rem --- 2. Ollama y modelo local ----------------------------------------------
echo  [2/6] Comprobando Ollama ^(modelo local para preguntas sencillas^)...
call ollama --version >nul 2>&1
if errorlevel 1 (
  echo        No encuentro Ollama. Jarvis funcionara igual con Claude y n8n.
  echo        Si quieres el modelo local gratis, instala Ollama desde https://ollama.com/download
  echo        y vuelve a ejecutar este archivo.
  goto :claude
)
call ollama list > "%TEMP%\jarvis-ollama.txt" 2>nul
findstr /c:"%MODELO_LOCAL%" "%TEMP%\jarvis-ollama.txt" >nul
if not errorlevel 1 (
  echo        Ollama OK y el modelo %MODELO_LOCAL% ya esta descargado.
  goto :claude
)
echo        Falta el modelo %MODELO_LOCAL% ^(unos 2 GB^).
set "RESP=N"
set /p "RESP=        Descargarlo ahora? (S/N): "
if /i not "%RESP%"=="S" (
  echo        De acuerdo, no se descarga. Puedes hacerlo luego con: ollama pull %MODELO_LOCAL%
  goto :claude
)
call ollama pull %MODELO_LOCAL%
if errorlevel 1 goto :error
echo        Modelo descargado.

:claude
echo.
rem --- 3. Claude Code (manos) ------------------------------------------------
echo  [3/6] Comprobando Claude Code ^(las "manos" de Jarvis^)...
call claude --version >nul 2>&1
if not errorlevel 1 (
  echo        Claude Code OK.
  goto :dependencias
)
echo        Claude Code no esta instalado. Sin el, Jarvis habla y piensa, pero no hace tareas en el PC.
set "RESP=N"
set /p "RESP=        Instalarlo ahora con npm install -g @anthropic-ai/claude-code? (S/N): "
if /i not "%RESP%"=="S" (
  echo        De acuerdo, no se instala.
  goto :dependencias
)
call npm install -g @anthropic-ai/claude-code
if errorlevel 1 goto :error
echo        Claude Code instalado. La primera vez, abre una terminal y escribe "claude" para iniciar sesion
echo        ^(o pega tu clave de Anthropic en Jarvis: Ajustes, Claves y servicios^).

:dependencias
echo.
rem --- 4. Dependencias ------------------------------------------------------
echo  [4/6] Instalando dependencias ^(npm install^). Puede tardar unos minutos...
call npm install
if errorlevel 1 goto :error
echo.

rem --- 5. Compilar ----------------------------------------------------------
echo  [5/6] Creando el instalador ^(npm run compilar^). Puede tardar unos minutos...
call npm run compilar
if errorlevel 1 goto :error
echo.

rem --- 6. Instalar ----------------------------------------------------------
echo  [6/6] Abriendo el instalador...
set "INSTALADOR="
for %%F in (dist\Jarvis-Setup-*.exe) do set "INSTALADOR=%%~fF"
if not defined INSTALADOR (
  echo  No encuentro dist\Jarvis-Setup-*.exe
  goto :error
)
echo        %INSTALADOR%
start "" "%INSTALADOR%"
echo.
echo  Listo. Sigue los pasos del instalador.
echo  Al abrir Jarvis: 1) pega las 3 direcciones de tu n8n en "Conectar Jarvis"
echo                   2) pega tus claves en Ajustes, "Claves y servicios" y pulsa "Probar".
echo.
pause
exit /b 0

:error
echo.
echo  ********************************************
echo   Algo ha fallado, haz una foto de esta
echo   ventana y enviala para que lo revisemos.
echo  ********************************************
echo.
pause
exit /b 1
