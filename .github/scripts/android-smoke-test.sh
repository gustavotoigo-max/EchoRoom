#!/usr/bin/env bash
# Instala o APK no emulador, abre o app e guarda log e prints em ./out
set -u
mkdir -p out
PKG=com.echoroom.app
adb install -r EchoRoom.apk > out/install.txt 2>&1 || true
adb logcat -c
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 > /dev/null 2>&1
sleep 12
adb exec-out screencap -p > out/tela-1.png
sleep 20
adb exec-out screencap -p > out/tela-2.png
if adb shell pidof "$PKG" > /dev/null; then echo "rodando" > out/status.txt; else echo "FECHOU" > out/status.txt; fi
adb logcat -d -v time > out/logcat.txt
grep -E "AndroidRuntime|ReactNativeJS|FATAL|ReactNative|unknown:React|Expo|libc|DEBUG|E/" out/logcat.txt | grep -v "chatty" | tail -400 > out/erros.txt || true
echo "status: $(cat out/status.txt)"
tail -n 60 out/erros.txt
