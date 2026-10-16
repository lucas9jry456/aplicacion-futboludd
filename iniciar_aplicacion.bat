@echo off
title Futbol AI Tracker - Servidor
cd /d "%~dp0"

echo ====================================================
echo        Iniciando Futbol AI Tracker...
echo ====================================================
echo.

"C:\Users\Usuario\anaconda3\python.exe" server.py

if %ERRORLEVEL% NEQ 0 (
    echo El servidor Python no pudo iniciarse, abriendo index.html directamente en tu navegador...
    start "" "index.html"
)
pause
