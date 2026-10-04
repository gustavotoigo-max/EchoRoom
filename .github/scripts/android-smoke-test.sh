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
# Toca no elemento com o texto (ou dica) informado.
tap() {
  adb shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1
  adb pull /sdcard/ui.xml out/ui.xml > /dev/null 2>&1
  xy=$(python3 - "$1" <<'PY'
import re, sys, xml.etree.ElementTree as ET
want = sys.argv[1]
for n in ET.parse('out/ui.xml').iter('node'):
    if want in (n.get('text') or '') or want in (n.get('hint') or '') or want in (n.get('content-desc') or ''):
        x1, y1, x2, y2 = map(int, re.findall(r'\d+', n.get('bounds')))
        print((x1 + x2) // 2, (y1 + y2) // 2)
        break
PY
)
  if [ -n "$xy" ]; then adb shell input tap $xy; echo "toque: $1 ($xy)"; else echo "não achei: $1"; fi
}

# Entrada sem Discord: nome → início
tap "Seu nome"
sleep 1
adb shell input text "Teste"
tap "Continuar"
sleep 6
adb exec-out screencap -p > out/tela-3.png
if adb shell pidof "$PKG" > /dev/null; then echo "rodando" > out/status.txt; else echo "FECHOU" > out/status.txt; fi
adb logcat -d -v time > out/logcat.txt
grep -E "AndroidRuntime|ReactNativeJS|FATAL|ReactNative|unknown:React|Expo|libc|DEBUG|E/" out/logcat.txt | grep -v "chatty" | tail -400 > out/erros.txt || true
echo "status: $(cat out/status.txt)"
tail -n 60 out/erros.txt
