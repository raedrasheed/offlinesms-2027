#!/usr/bin/env bash
# On-device timing for OfflineSMS test builds (same phone, same network for
# the "before" and "after" APK). Requires adb and ONE connected device.
#
#   scripts/device/perf-capture.sh coldstart <label> [runs=10]
#       force-stop → launch → `am start -W` TotalTime, plus the app's own
#       [perf] marks (needs a build made with EXPO_PUBLIC_PERF_LOG=1).
#   scripts/device/perf-capture.sh session <label> [seconds=180]
#       records [perf] marks while YOU open conversations, scroll up for older
#       messages, send messages and tap notifications; prints spans.
#
# Output: perf-<label>-<mode>-<timestamp>.csv in the current directory.
set -euo pipefail
PKG=app.offlinesms.mobile
MODE=${1:?coldstart|session}; LABEL=${2:?label e.g. before|after}; N=${3:-}
TS=$(date +%Y%m%d-%H%M%S); OUT="perf-$LABEL-$MODE-$TS.csv"
adb get-state >/dev/null
echo "device,$(adb shell getprop ro.product.model | tr -d '\r'),android,$(adb shell getprop ro.build.version.release | tr -d '\r'),build,$(adb shell dumpsys package $PKG | grep -m1 versionName | tr -d ' \r')" > "$OUT"

median() { sort -n | awk '{a[NR]=$1} END {if (NR==0) {print "-"} else if (NR%2) {print a[(NR+1)/2]} else {print (a[NR/2]+a[NR/2+1])/2}}'; }

if [ "$MODE" = coldstart ]; then
  RUNS=${N:-10}
  echo "run,total_time_ms,auth_resolved_ms,chatlist_first_render_ms" >> "$OUT"
  for i in $(seq 1 "$RUNS"); do
    adb shell am force-stop $PKG; sleep 2; adb logcat -c
    T=$(adb shell am start -W -n $PKG/.MainActivity | tr -d '\r' | awk -F': ' '/TotalTime/ {print $2}')
    sleep 8
    L=$(adb logcat -d -s ReactNativeJS:V | tr -d '\r')
    A=$(grep -o '\[perf\] auth:resolved +[0-9]*' <<<"$L" | head -1 | grep -o '[0-9]*$' || true)
    C=$(grep -o '\[perf\] chatList:firstLocalRender +[0-9]*' <<<"$L" | head -1 | grep -o '[0-9]*$' || true)
    echo "$i,$T,${A:-},${C:-}" >> "$OUT"; echo "run $i: TotalTime=${T}ms auth=${A:-?} chatList=${C:-?}"
  done
  echo "median TotalTime: $(tail -n +3 "$OUT" | cut -d, -f2 | median) ms"
  echo "median chatList first render: $(tail -n +3 "$OUT" | cut -d, -f4 | grep . | median) ms"
else
  SECS=${N:-180}
  echo "Recording [perf] marks for ${SECS}s — open chats, load older messages, send, tap notifications now."
  adb logcat -c
  timeout "$SECS" adb logcat -s ReactNativeJS:V | tr -d '\r' | grep --line-buffered '\[perf\]' | tee "$OUT.raw" || true
  echo "span,ms" >> "$OUT"
  # Pair each start mark with the next end mark.
  awk '
    /\[perf\] conversation:open/ {o=$0; sub(/.*\+/,"",o); sub(/ms.*/,"",o); open=o}
    /\[perf\] conversation:firstLocalRender/ && open!="" {e=$0; sub(/.*\+/,"",e); sub(/ms.*/,"",e); print "conversation_open," e-open; open=""}
    /\[perf\] push:tap/ {t=$0; sub(/.*\+/,"",t); sub(/ms.*/,"",t); tap=t}
    /\[perf\] push:targetVisible/ && tap!="" {e=$0; sub(/.*\+/,"",e); sub(/ms.*/,"",e); print "push_tap_to_visible," e-tap; tap=""}
  ' "$OUT.raw" >> "$OUT"
  for s in conversation_open push_tap_to_visible; do
    echo "median $s: $(grep "^$s," "$OUT" | cut -d, -f2 | median) ms ($(grep -c "^$s," "$OUT") samples)"
  done
fi
echo "wrote $OUT"
