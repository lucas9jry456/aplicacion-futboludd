@echo off
chcp 65001 > nul
cd /d "%~dp0"
title FutbolIA - Sistema de Seguimiento y Analisis de Futbol
cls


echo =====================================================================
echo       FUTBOL IA - SEGUIMIENTO INTELIGENTE DE PARTIDOS
echo            (Web + Celular / PC / Camara en Vivo)
echo =====================================================================
echo.

set PYTHON_EXE=C:\Users\Usuario\anaconda3\python.exe

if not exist "%PYTHON_EXE%" (
    where python >nul 2>nul
    if %errorlevel% equ 0 (
        set PYTHON_EXE=python
    ) else (
        where py >nul 2>nul
        if %errorlevel% equ 0 (
            set PYTHON_EXE=py
        ) else (
            echo [ERROR] No se encontro Python ni Anaconda en su sistema.
            echo Por favor instale Python 3.10 o asegurese de tener Anaconda.
            pause
            exit /b 1
        )
    )
)

echo [*] Utilizando interprete Python: %PYTHON_EXE%
echo [*] Iniciando servidor y sistema de IA...
echo.

"%PYTHON_EXE%" run.py

if %errorlevel% neq 0 (
    echo.
    echo [!] Hubo un problema al iniciar la aplicacion.
    pause
)
