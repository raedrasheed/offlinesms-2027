#!/usr/bin/env bash
# On-device timing with the matched test builds (docs/TEST_BUILDS.md §4).
# Requires adb and ONE connected phone. Same phone, same network, same account
# for the "baseline" and "updated" runs.
#
#   scripts/device/perf-capture.sh coldstart <label> [runs=10]
#       force-stop → launch → `am start -W` TotalTime, plus the app's own
#       auth:resolved / chatList:shown marks.
#   scripts/device/perf-capture.sh session <label> [seconds=240]
#       records spans while YOU: open 5 chats, scroll to the top twice in one
#       chat ("load older"), send 5 messages, and tap 3 notifications sent from
#       the other phone. Prints medians per span.
#
# Output: perf-<label>-<mode>-<timestamp>.csv in the current directory.
set -euo pipefail
PKG=${PKG:-app.offlinesms.mobile.test}
MODE=${1:?coldstart|session}; LABEL=${2:?label e.g. baseline|updated}; N=${3:-}
TS=$(date +%Y%m%d-%H%M%S); OUT="perf-$LABEL-$MODE-$TS.csv"
adb get-state >/dev/null
VER=$(adb shell dumpsys package "$PKG" | grep -m1 versionName | tr -d ' \r')
echo "# device=$(adb shell getprop ro.product.model | tr -d '\r') android=$(adb shell getprop ro.build.version.release | tr -d '\r') $VER" > "$OUT"

median() { sort -n | awk '{a[NR]=$1} END {if (NR==0) {print "-"} else if (NR%2) {print a[(NR+1)/2]} else {print (a[NR/2]+a[NR/2+1])/2}}'; }

if [ "$MODE" = coldstart ]; then
  RUNS=${N:-10}
  echo "run,total_time_ms,auth_resolved_ms,chatlist_shown_ms" >> "$OUT"
  for i in $(seq 1 "$RUNS"); do
    adb shell am force-stop "$PKG"; sleep 2; adb logcat -c
    T=$(adb shell am start -W -n "$PKG/app.offlinesms.mobile.MainActivity" | tr -d '\r' | awk -F': ' '/TotalTime/ {print $2}')
    sleep 8
    L=$(adb logcat -d -s ReactNativeJS:V | tr -d '\r')
    A=$(grep -o '\[perf\] mark auth:resolved +[0-9]*' <<<"$L" | head -1 | grep -o '[0-9]*$' || true)
    C=$(grep -o '\[perf\] mark chatList:shown +[0-9]*' <<<"$L" | head -1 | grep -o '[0-9]*$' || true)
    echo "$i,$T,${A:-},${C:-}" >> "$OUT"; echo "run $i: TotalTime=${T}ms auth=${A:-?} chatList=${C:-?}"
  done
  echo "median TotalTime:       $(grep -v '^#\|^run' "$OUT" | cut -d, -f2 | median) ms"
  echo "median auth:resolved:   $(grep -v '^#\|^run' "$OUT" | cut -d, -f3 | grep . | median) ms"
  echo "median chatList:shown:  $(grep -v '^#\|^run' "$OUT" | cut -d, -f4 | grep . | median) ms"
else
  SECS=${N:-240}
  echo "Recording for ${SECS}s — open chats, load older, send, tap notifications now."
  adb logcat -c
  timeout "$SECS" adb logcat -s ReactNativeJS:V | tr -d '\r' | grep --line-buffered '\[perf\] span' | tee "$OUT.raw" || true
  echo "span,ms" >> "$OUT"
  sed -E 's/.*\[perf\] span ([a-z_]+) ([0-9]+).*/\1,\2/' "$OUT.raw" >> "$OUT"
  for s in conversation_open push_to_visible send_to_visible older_to_visible; do
    printf "median %-18s %s ms (%s samples)\n" "$s" "$(grep "^$s," "$OUT" | cut -d, -f2 | median)" "$(grep -c "^$s," "$OUT" || true)"
  done
fi
echo "wrote $OUT"
