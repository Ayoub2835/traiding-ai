@echo off
rem ==========================================================================
rem  INSTALAR-JARVIS.bat
rem  Compila Jarvis en este PC y abre el instalador.
rem  1) Comprueba que Node.js esta instalado
rem  2) npm install      (descarga las dependencias)
rem  3) npm run compilar (descarga el modelo de voz y crea el instalador .exe)
rem  4) Abre dist\Jarvis-Setup-*.exe
rem ==========================================================================
chcp 65001 >nul
setlocal
title Instalar Jarvis
cd /d "%~dp0"

echo.
echo  ============================================
echo     J.A.R.V.I.S.  -  Instalacion
echo  ============================================
echo.

rem --- 1. Node.js -----------------------------------------------------------
echo  [1/4] Comprobando Node.js...
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

rem --- 2. Dependencias ------------------------------------------------------
echo  [2/4] Instalando dependencias ^(npm install^). Puede tardar unos minutos...
call npm install
if errorlevel 1 goto :error
echo.

rem --- 3. Compilar ----------------------------------------------------------
echo  [3/4] Creando el instalador ^(npm run compilar^). Puede tardar unos minutos...
call npm run compilar
if errorlevel 1 goto :error
echo.

rem --- 4. Abrir el instalador -----------------------------------------------
echo  [4/4] Abriendo el instalador...
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
echo  Al abrir Jarvis por primera vez te pedira las 3 direcciones de tu n8n.
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
