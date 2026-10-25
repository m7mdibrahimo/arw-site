#!/usr/bin/env bash
# تركيب المراقب التقني كخدمة دايمة على الماك (launchd).
#
#   scripts/monitor/install-macos.sh                # كل ساعة في الدقيقة ٥ (زي ما اتفقنا)
#   scripts/monitor/install-macos.sh --every 5      # كل ٥ دقايق (كشف أسرع)
#   scripts/monitor/install-macos.sh --with-tests   # يشغّل الاختبارات والبناء كمان
#   scripts/monitor/install-macos.sh --status       # شوف حالته
#   scripts/monitor/install-macos.sh --uninstall    # شيل الخدمة
#   scripts/monitor/install-macos.sh --print        # اطبع ملف الخدمة بس (من غير تركيب)
#
# ملاحظة صريحة: launchd مش بيشغّل الوظايف لما الماك ينام، فمش بديل عن GitHub Actions.
# ده احتياطي محلي بس. الأساسي هو .github/workflows/site-watch.yml (بيشتغل على سيرفرات
# جيتهب مش على جهازك، فمش محتاج الماك يكون شغّال).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LABEL="com.arw.watch"
AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST="$AGENTS_DIR/$LABEL.plist"
LOG_DIR="$ROOT/reports/guard"
UID_NUM="$(id -u)"
NODE_BIN="$(command -v node || true)"
TSX_CLI="$ROOT/node_modules/tsx/dist/cli.mjs"

EVERY_MIN=""
WITH_TESTS=""
PRINT_ONLY=""

status() {
  echo "الملف: $PLIST"
  if [ -f "$PLIST" ]; then
    launchctl print "gui/$UID_NUM/$LABEL" 2>/dev/null | grep -E "state|runs|last exit" | head -6 || echo "(مش محمّلة)"
  else
    echo "(مش مركّبة)"
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --uninstall)
      launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
      rm -f "$PLIST"
      echo "✅ اتشالت الخدمة $LABEL"
      exit 0
      ;;
    --status)
      status
      exit 0
      ;;
    --print)
      PRINT_ONLY="1"
      shift
      ;;
    --every)
      EVERY_MIN="${2:?--every محتاج رقم دقايق}"
      shift 2
      ;;
    --with-tests)
      WITH_TESTS="1"
      shift
      ;;
    *)
      echo "خيار مش معروف: $1" >&2
      exit 2
      ;;
  esac
done

# مسارات مطلقة: launchd مابيشوفش الـPATH بتاعك، وnode عندك في /opt/homebrew/bin
[ -n "$NODE_BIN" ] || { echo "❌ مش لاقي node في الـPATH" >&2; exit 1; }
[ -f "$TSX_CLI" ] || { echo "❌ مش لاقي tsx — نفّذ npm install الأول" >&2; exit 1; }

# وضع العرض: نطبع محتوى الملف بس من غير أي تركيب ولا كتابة على الجهاز
if [ -n "$PRINT_ONLY" ]; then
  PLIST_TARGET="/dev/stdout"
else
  PLIST_TARGET="$PLIST"
  mkdir -p "$LOG_DIR" "$AGENTS_DIR"
fi

# توقيت: كل ساعة في الدقيقة ٥ (زي المطلوب)، أو كل N دقيقة لو طلبت
if [ -n "$EVERY_MIN" ]; then
  SCHEDULE="    <key>StartInterval</key>
    <integer>$((EVERY_MIN * 60))</integer>"
  WHEN="كل $EVERY_MIN دقيقة"
else
  SCHEDULE="    <key>StartCalendarInterval</key>
    <dict>
        <key>Minute</key>
        <integer>5</integer>
    </dict>"
  WHEN="كل ساعة في الدقيقة ٥"
fi

TESTS_ARG=""
[ -n "$WITH_TESTS" ] && TESTS_ARG="        <string>--with-tests</string>"

cat >"$PLIST_TARGET" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_BIN</string>
        <string>$TSX_CLI</string>
        <string>$ROOT/scripts/monitor/watch.ts</string>
        <string>--once</string>
$TESTS_ARG
    </array>
    <key>WorkingDirectory</key>
    <string>$ROOT</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
$SCHEDULE
    <key>StandardOutPath</key>
    <string>$LOG_DIR/launchd.out.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/launchd.err.log</string>
    <key>ProcessType</key>
    <string>Background</string>
    <key>LowPriorityIO</key>
    <true/>
    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>
PLIST_EOF

if [ -n "$PRINT_ONLY" ]; then
  exit 0
fi

launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID_NUM" "$PLIST"
launchctl enable "gui/$UID_NUM/$LABEL" 2>/dev/null || true

echo "✅ المراقب مركّب على الماك — $WHEN"
[ -n "$WITH_TESTS" ] && echo "   وبيشغّل الاختبارات والبناء كمان"
echo "   اللوجات: $LOG_DIR"
echo
status
