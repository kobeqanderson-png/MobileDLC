@echo off
title Mobile DLC Labeler
cd /d "%~dp0"
echo Starting Mobile DLC Labeler from %cd%
set "PROJECT=C:\Users\kobeq\Documents\checking protocol\sp1DLC"
if not exist "%PROJECT%\config.yaml" (
  echo DLC project not found: %PROJECT%
  pause
  exit /b 1
)
echo Loading full project: %PROJECT%
python app.py "%PROJECT%" --schema focus7 --state-dir "%~dp0full_project_state" --port 8877
echo.
echo Labeler stopped. If a page did not open, use the Launch screen URL printed above.
pause
