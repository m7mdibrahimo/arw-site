#!/usr/bin/env bash
# لفة المراقبة الساعية — بيشغّلها GitHub Actions (٢٤/٧ حقيقي) أو launchd (احتياطي محلي).
#
#   scripts/monitor/run-round.sh              # لفة كاملة
#   scripts/monitor/run-round.sh --dry-run    # الأوامر بس من غير تشغيل
#
# المتغيّرات الاختيارية:
#   ARW_GUARD_AGENT     اسم الوكيل (افتراضي: site-guard)
#   ARW_GUARD_MODEL     موديل واحد بصيغة provider/model
#   ARW_GUARD_MODELS    قايمة موديلات بالفواصل (بيجرّبهم بالترتيب لحد ما واحد ينجح)
#   ARW_GUARD_SKIP_CI=1 يتخطّى npm ci (لو الحزم مركّبة بالفعل)
#   ARW_GUARD_TIMEOUT   أقصى مدة للفة بالدقايق (افتراضي 60)
#
# ملاحظة: السكربت بيعمل commit بس — **مابيدفعش**. الدفع بيتعمل في الـworkflow
# بعد فحص مستقل (اختبارات + بناء)، عشان أي كود مكسور مايوصلش للموقع.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 1

AGENT="${ARW_GUARD_AGENT:-site-guard}"
TIMEOUT_MIN="${ARW_GUARD_TIMEOUT:-60}"
LOG_DIR="$ROOT/reports/guard"
mkdir -p "$LOG_DIR"

STAMP="$(date +%Y-%m-%dT%H%M%S)"
LOG="$LOG_DIR/round-$STAMP.log"
START="$(date +%s)"

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

find_opencode() {
  if [ -n "${OPENCODE_BIN:-}" ] && [ -x "${OPENCODE_BIN}" ]; then echo "$OPENCODE_BIN"; return; fi
  if command -v opencode >/dev/null 2>&1; then command -v opencode; return; fi
  local bundled="/Applications/OpenCode.app/Contents/Resources/opencode-cli"
  if [ -x "$bundled" ]; then echo "$bundled"; return; fi
  if [ -x "$HOME/.opencode/bin/opencode" ]; then echo "$HOME/.opencode/bin/opencode"; return; fi
  echo ""
}

CLI="$(find_opencode)"

# الموديلات بترجّع أخطاء وبتزنق، واللفة لازم متقفش: بنجرّب بالترتيب لحد ما واحد ينجح.
# (الأسماء دي من `opencode models | grep free` — أي اسم مش موجود بيرجع «Model unavailable».)
DEFAULT_MODELS="opencode/deepseek-v4.1-flash-free,opencode/glm-5.3-flash-free,opencode/mimo-v2.6-flash-free,opencode/flint-40b-free,opencode/beam-free,opencode/nemotron-3.5-lightning-free"
MODELS_CSV="${ARW_GUARD_MODEL:-${ARW_GUARD_MODELS:-$DEFAULT_MODELS}}"
IFS=',' read -r -a MODELS <<<"$MODELS_CSV"

PROMPT="ابدأ لفة المراقبة الساعية دلوقتي. نفّذ الخطوات الستة كلها بالترتيب، والتزم بكل الممنوعات، وصلّح من الجذر، واعمل commit في الآخر زي خطوة ٦. الدفع (push) بيتعمل بواسطة الـworkflow — لو رجع مرفوض ده متوقع وكمّل. متسألش أي سؤال ومتبعتش أي رسالة."

if [ "${1:-}" = "--dry-run" ]; then
  echo "CLI=${CLI:-<مش موجود>}"
  echo "ROOT=$ROOT"
  echo "AGENT=$AGENT"
  echo "LOG=$LOG"
  echo "MODELS=${MODELS[*]}"
  echo "SKIP_CI=${ARW_GUARD_SKIP_CI:-0}"
  echo "TIMEOUT=${ARW_GUARD_TIMEOUT:-60}"
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

# مهلة محمولة: GitHub Actions عنده timeout، والماك مفيهوش `timeout` افتراضيًا.
run_with_timeout() {
  local secs="$1"; shift
  if command -v timeout >/dev/null 2>&1; then timeout "$secs" "$@"; return $?; fi
  if command -v gtimeout >/dev/null 2>&1; then gtimeout "$secs" "$@"; return $?; fi
  "$@" & local pid=$!
  ( sleep "$secs"; kill -TERM "$pid" 2>/dev/null ) & local watcher=$!
  wait "$pid"; local rc=$?
  kill "$watcher" 2>/dev/null
  return $rc
}

# المهلة للفة كلها، مش لكل موديل: موديل بيفشل قرب آخر مهلته كان بيدّي اللي بعده ساعة
# جديدة، فاللفة وصلت ١١٩ دقيقة والـjob اتقتل قبل البوابة والدفع (2026-10-28).
DEADLINE=$((START + TIMEOUT_MIN * 60))

for M in "${MODELS[@]}"; do
  LEFT=$((DEADLINE - $(date +%s)))
  if [ "$LEFT" -lt 300 ]; then
    log "ميزانية اللفة (${TIMEOUT_MIN} دقيقة) خلصت — مش بجرّب $M"
    [ "$CODE" -eq 0 ] || CODE=124
    break
  fi
  log "محاولة بالموديل: $M (باقي $((LEFT / 60)) دقيقة)"
  # --auto       : يوافق على الصلاحيات غير الممنوعة (الممنوعات في ملف الوكيل)
  # --standalone : سيرفر خاص — مطلوب على سيرفرات CI
  run_with_timeout "$LEFT" \
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
  # ١٢٤ = المهلة خلصت. مفيش فايدة من موديل تاني (هياخد مهلة كاملة كمان) — بنقف.
  if [ "$CODE" -eq 124 ]; then
    log "الموديل $M خلّص ميزانية اللفة (${TIMEOUT_MIN} دقيقة) — مش بجرّب غيره"
    break
  fi
  log "فشل الموديل $M (كود $CODE) — بجرّب اللي بعده"
done

END="$(date +%s)"
DURATION=$((END - START))
log "نهاية اللفة: كود=$CODE مدة=${DURATION}ث موديل=${USED_MODEL:-—}"

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
