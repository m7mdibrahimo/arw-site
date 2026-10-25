#!/usr/bin/env bash
# لفة المراقبة الساعية — بيشغّلها GitHub Actions (٢٤/٧ حقيقي) أو launchd (احتياطي محلي).
#
# الاستخدام:
#   scripts/monitor/run-round.sh              # لفة كاملة
#   scripts/monitor/run-round.sh --dry-run    # الأوامر بس من غير تشغيل
#
# المتغيّرات الاختيارية:
#   ARW_GUARD_AGENT   اسم الوكيل (افتراضي: site-guard)
#   ARW_GUARD_MODEL   موديل واحد بصيغة provider/model
#   ARW_GUARD_MODELS  قايمة موديلات بالفواصل (بيجرّبهم بالترتيب لحد ما واحد ينجح)
#   ARW_GUARD_SKIP_CI=1  يتخطّى npm ci (لو الحزم مركّبة بالفعل)

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 1

AGENT="${ARW_GUARD_AGENT:-site-guard}"
LOG_DIR="$ROOT/reports/guard"
mkdir -p "$LOG_DIR"

STAMP="$(date +%Y-%m-%dT%H%M%S)"
LOG="$LOG_DIR/round-$STAMP.log"
START="$(date +%s)"

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

# ── الـ CLI: من المتغيّر، أو من الـ PATH، أو من جوه تطبيق OpenCode، أو من التركيب المحلي ──
find_opencode() {
  if [ -n "${OPENCODE_BIN:-}" ] && [ -x "${OPENCODE_BIN}" ]; then echo "$OPENCODE_BIN"; return; fi
  if command -v opencode >/dev/null 2>&1; then command -v opencode; return; fi
  local bundled="/Applications/OpenCode.app/Contents/Resources/opencode-cli"
  if [ -x "$bundled" ]; then echo "$bundled"; return; fi
  if [ -x "$HOME/.opencode/bin/opencode" ]; then echo "$HOME/.opencode/bin/opencode"; return; fi
  echo ""
}

CLI="$(find_opencode)"

# الموديلات المجانية بتزنق وبتغلط، واللفة لازم متقفش: فبنجرّب بالترتيب لحد ما واحد ينجح.
# الافتراضي (مجاني بالكامل) — الأول أقواهم في استخدام الأدوات:
DEFAULT_MODELS="opencode/deepseek-v4.1-flash-free,opencode/muse-spark-1.3-contributor-free,opencode/longcat-2.5-preview-free,opencode/cat-jam-free"
MODELS_CSV="${ARW_GUARD_MODEL:-${ARW_GUARD_MODELS:-$DEFAULT_MODELS}}"
IFS=',' read -r -a MODELS <<<"$MODELS_CSV"

PROMPT="ابدأ لفة المراقبة الساعية دلوقتي. نفّذ الخطوات الستة كلها بالترتيب، والتزم بكل الممنوعات، وصلّح من الجذر، ثم اعمل commit و pull --rebase و push زي ما مكتوب في خطوة ٦. متسألش أي سؤال ومتبعتش أي رسالة."

# ── الفحص الجاف: بيتشغّل حتى لو الـCLI مش مركّب (مفيد في الاختبارات) ──
if [ "${1:-}" = "--dry-run" ]; then
  echo "CLI=${CLI:-<مش موجود>}"
  echo "ROOT=$ROOT"
  echo "AGENT=$AGENT"
  echo "LOG=$LOG"
  echo "MODELS=${MODELS[*]}"
  echo "SKIP_CI=${ARW_GUARD_SKIP_CI:-0}"
  echo "PROMPT=$PROMPT"
  exit 0
fi

# ── تجهيز البيئة: الحزم (المشروع + الـworker — الاختبارات محتاجة الاتنين) ──
if [ "${ARW_GUARD_SKIP_CI:-0}" != "1" ]; then
  log "تجهيز الحزم (npm ci)…"
  npm ci --no-audit --no-fund >>"$LOG" 2>&1 || log "⚠️ npm ci فشل في المشروع"
  if [ -f worker/package.json ]; then
    (cd worker && npm ci --no-audit --no-fund) >>"$LOG" 2>&1 || log "⚠️ npm ci فشل في worker"
  fi
fi

if [ -z "$CLI" ]; then
  log "فشل: مش لاقي opencode. حدّد OPENCODE_BIN."
  exit 127
fi

log "بداية لفة الحارس (agent=$AGENT) pid=$$"

CODE=1
USED_MODEL=""
for M in "${MODELS[@]}"; do
  log "محاولة بالموديل: $M"
  # --auto       : يوافق على الصلاحيات غير الممنوعة (الممنوعات في ملف الوكيل)
  # --standalone : سيرفر خاص — مطلوب على سيرفرات CI اللي مفيش فيها خدمة خلفية
  "$CLI" run \
    --agent "$AGENT" \
    --auto \
    --standalone \
    --title "لفة الحارس $STAMP ($M)" \
    --model "$M" \
    "$PROMPT" >>"$LOG" 2>&1
  CODE=$?
  if [ "$CODE" -eq 0 ]; then
    USED_MODEL="$M"
    break
  fi
  log "فشل الموديل $M (كود $CODE) — بجرّب اللي بعده"
done

END="$(date +%s)"
DURATION=$((END - START))
log "نهاية اللفة: كود=$CODE مدة=${DURATION}ث موديل=${USED_MODEL:-—}"

# حالة آخر لفة — الـworkflow والمشرف بيقروا منها
cat >"$LOG_DIR/last-round.json" <<JSON
{
  "stamp": "$STAMP",
  "startedAt": $START,
  "durationSec": $DURATION,
  "exitCode": $CODE,
  "agent": "$AGENT",
  "model": "$USED_MODEL",
  "log": "reports/guard/round-$STAMP.log"
}
JSON

if [ "$CODE" -ne 0 ]; then
  echo "[$(date +%H:%M:%S)] اللفة فشلت (كود $CODE) — شوف $LOG" >>"$LOG_DIR/failures.log"
fi

exit $CODE
