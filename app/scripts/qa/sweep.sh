#!/bin/zsh
# Full-league headless sweep (HANDOFF §9 "any season 2010–latest with any team").
# 32 teams × 5 start years × 4 seasons, three runs at a time. One CSV row per run.
set -u
APP=/Users/daniel.portuondo/nfl-gm/app
OUT=${1:-/tmp/gridiron-sweep.csv}
JOBS=$(mktemp)
for t in ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAR LAC LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS; do
  for y in 2010 2014 2018 2022 2025; do
    echo "$t $y" >> "$JOBS"
  done
done
echo "team,start,final,invariants" > "$OUT"
cd "$APP"
xargs -P 3 -L 1 sh -c '
  log=$(pnpm headless -- --team "$0" --start "$1" --seasons 4 --quiet 2>&1)
  final=$(printf "%s\n" "$log" | grep -E "^final:" | tail -1 | tr "," ";")
  inv=$(printf "%s\n" "$log" | grep -E "^invariants:" | tail -1)
  if [ -z "$final$inv" ]; then final="ERROR: $(printf "%s\n" "$log" | grep -iE "error|throw" | head -1 | tr "," ";" | cut -c1-160)"; fi
  echo "$0,$1,$final,$inv"
' < "$JOBS" >> "$OUT"
rm -f "$JOBS"
echo "runs: $(($(wc -l < "$OUT") - 1))"
echo "invariants ok: $(grep -c 'invariants: ok' "$OUT")"
echo "not ok:"; grep -v 'invariants: ok' "$OUT" | grep -v '^team,' | head -20
