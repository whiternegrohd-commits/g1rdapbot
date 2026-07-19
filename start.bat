@echo off
title Discord Bot - Girdap
color 0A

REM Change to the directory where this script resides
cd /d "%~dp0"

REM Check if .env file exists
if not exist ".env" (
    echo.
    echo [ERROR] .env file not found!
    echo.
    echo Please create .env file with:
    echo DISCORD_TOKEN=YOUR_BOT_TOKEN_HERE
    echo.
    pause
    exit /b 1
)

REM Install dependencies if node_modules doesn't exist
if not exist "node_modules" (
    echo.
    echo Installing npm packages...
    call npm install
    echo.
)

REM Start the bot
echo.
echo Starting Discord Bot...
echo.
node src/index.js

REM If the script reaches here, the bot crashed or closed
echo.
echo [ERROR] Bot stopped or crashed!
echo Press any key to close this window...
pause
exit /b 1
