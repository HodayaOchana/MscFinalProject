@echo off
rem BookBridge - daily model re-training (see CF\retrain.js).
rem Runs from the project folder, appends everything to logs\retrain.log
cd /d "%~dp0.."
if not exist logs mkdir logs
echo ===== %date% %time% >> logs\retrain.log
node CF\retrain.js %* >> logs\retrain.log 2>&1
