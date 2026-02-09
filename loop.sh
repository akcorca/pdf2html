#!/usr/bin/env bash
set -euo pipefail

while true; do
  for pdf in data/*.pdf; do
    doc="$(basename "$pdf")"
    codex exec --yolo "docs/improvement.md를 읽고 절차에 따라 품질을 개선한다. ${doc} 문서의 품질을 딱 하나만 개선하고 커밋한 뒤 중단할 것."
  done
done
