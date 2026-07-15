@echo off
cd /d "%~dp0"
start /b powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0SysViewControl.ps1"
