#!/bin/bash
# Build HTML documentation from markdown sources
# Requires: pandoc

set -e
DOCS_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$DOCS_DIR/html"
TEMPLATE="$DOCS_DIR/_template.html"

mkdir -p "$OUT_DIR"

declare -A TITLES
TITLES[README]="Documentation Home"
TITLES[architecture]="Architecture"
TITLES[architecture-decisions]="Architecture Decisions"
TITLES[getting-started]="Getting Started"
TITLES[tracing]="Distributed Tracing"
TITLES[migration]="Migration Guide"
TITLES[migration-per-service]="Service Migration Reference"
TITLES[deployment-pm2]="Deployment"
TITLES[sdk-explained]="SDK Internals"
TITLES[sdk-deployment]="SDK Deployment"

SLUGS=(README architecture architecture-decisions getting-started tracing migration migration-per-service deployment-pm2 sdk-explained sdk-deployment)
OUT_NAMES=(index architecture architecture-decisions getting-started tracing migration migration-per-service deployment-pm2 sdk-explained sdk-deployment)

for i in "${!SLUGS[@]}"; do
  slug="${SLUGS[$i]}"
  out="${OUT_NAMES[$i]}"
  title="${TITLES[$slug]}"
  src="$DOCS_DIR/${slug}.md"

  if [ ! -f "$src" ]; then
    echo "  ✗ ${slug}.md not found, skipping"
    continue
  fi

  # Convert .md links to .html links
  sed 's/\(\[.*\]\)(\([^)]*\)\.md)/\1(\2.html)/g' "$src" | \
  pandoc \
    --from=gfm \
    --to=html5 \
    --template="$TEMPLATE" \
    --metadata title="$title" \
    --metadata current="$out" \
    --highlight-style=zenburn \
    --no-highlight \
    -o "$OUT_DIR/${out}.html"

  echo "  ✓ ${out}.html"
done

echo ""
echo "Done. ${#SLUGS[@]} pages → $OUT_DIR/"
