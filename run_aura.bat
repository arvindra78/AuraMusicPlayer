@echo off
if "%~1"=="-h" goto :run

:run
cd /d "%~dp0"
npm start
