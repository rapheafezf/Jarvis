@echo off
chcp 65001 >nul
title J.A.R.V.I.S.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js est introuvable. Installez-le depuis https://nodejs.org puis relancez ce fichier.
  pause
  exit /b 1
)
if exist cle-api.txt set /p ANTHROPIC_API_KEY=<cle-api.txt
node server.js --ouvrir
echo.
echo Le serveur s'est arrete. Copiez le message ci-dessus si vous avez besoin d'aide.
pause
