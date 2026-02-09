#!/usr/bin/env bash
set -euo pipefail

# Convert all PDFs to PNG once before entering the loop
for pdf in data/*.pdf; do
  doc="$(basename "${pdf%.pdf}")"
  outdir="data/work/png/$doc"
  if [ ! -d "$outdir" ]; then
    node src/cli.ts pdf2png "$pdf" "$outdir"
  fi
done

while true; do
  for pdf in data/*.pdf; do
    doc="$(basename "$pdf")"
    codex exec --yolo "docs/improvement.md를 읽고 절차에 따라 품질을 개선한다. ${doc} 문서에 집중해서 절차를 1회 수행하고 중단할 것."
    codex exec --yolo "로직을 더 간소화하면서도 테스트를 모두 통과시킬 방법이 있는지 찾아서 개선하고 커밋할 것. 좋은 방법이 없으면 중단할 것."

    # Push if there are 5 or more unpushed commits
    unpushed=$(git log --oneline @{u}..HEAD 2>/dev/null | wc -l | tr -d ' ')
    if [ "$unpushed" -ge 5 ]; then
      git push
    fi
  done
done
