#!/bin/bash
# usage: m.sh label [runs] [hidemap]  -- each run: fresh launch of Compare (19 laps), top of page, Play 7 s
export PATH="$PATH:/c/Users/Botkin/AppData/Local/Android/Sdk/platform-tools"
P=app.botracing.android
L=$(for i in $(seq 3 21); do printf '28fcfa6112f0d18a-%03d,' $i; done); L=${L%,}
for r in $(seq 1 ${2:-3}); do
  adb shell am force-stop $P; sleep 1
  adb shell am start -a android.intent.action.VIEW -d "'botracing61:///session/3e9604757ce93c23/compare?laps=$L'" $P >/dev/null 2>&1
  sleep 16
  adb shell input swipe 540 700 540 1700 150; sleep 1
  [ -n "$3" ] && { adb shell input tap 960 223; sleep 2; }
  adb shell dumpsys gfxinfo $P reset >/dev/null; adb shell input tap 325 2124; sleep 7
  adb shell dumpsys gfxinfo $P framestats > "$TEMP/fs_$1_$r.txt"
  adb exec-out screencap -p > "$TEMP/shot_$1_$r.png"
  node -e '
const raw=require("fs").readFileSync(process.argv[1],"utf8").split("---PROFILEDATA---")[1].trim().split("\n");
const h=raw[0].split(",");const t=raw.slice(1).map(l=>l.split(",").map(Number)).filter(r=>r.length>=16&&r[0]===0);
const c=n=>h.indexOf(n);const d=(a,b)=>t.map(r=>(r[c(b)]-r[c(a)])/1e6).filter(x=>x>=0&&x<1000).sort((x,y)=>x-y);
const q=(v,p)=>v[Math.floor(v.length*p)];
const tot=d("IntendedVsync","FrameCompleted");const dr=d("DrawStart","SyncQueued");
console.log(process.argv[2],"frames",t.length,"total p50/p90/p99",q(tot,.5).toFixed(0),q(tot,.9).toFixed(0),q(tot,.99).toFixed(0),"| draw p50",q(dr,.5).toFixed(0));' "$TEMP/fs_$1_$r.txt" "$1 run$r"
done
