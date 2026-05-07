@echo off
title DevToolbox Launcher - All Servers

echo.
echo  ======================================================
echo     DevToolbox - Integrated Backend Launcher
echo  ======================================================
echo.

:: 1. Video Downloader (Python)
echo [1/3] Starting Video Downloader (Python on Port 5000)...
start "Video Downloader Server" cmd /k "python downloader_server.py"

:: 2. Link Analyzer (Node.js)
echo [2/3] Starting Link Analyzer Backend (Node.js on Port 3000)...
start "Link Analyzer Backend" cmd /k "cd devtoolbox-backend && npm start"

:: 3. Jekyll Site
echo [3/3] Starting Jekyll Site (Port 4000)...
start "Jekyll Site" cmd /k "bundle exec jekyll serve"

echo.
echo  ------------------------------------------------------
echo   SUCCESS: All servers are launching in separate windows.
echo   Keep those windows open while using the tools.
echo  ------------------------------------------------------
echo.
pause
