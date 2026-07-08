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
TITLES[getting-started]="Quick Start"
TITLES[configuration]="Configuration Reference"
TITLES[logging]="Structured Logging"
TITLES[tracing]="Distributed Tracing"
TITLES[metrics]="Metrics & Dashboards"
TITLES[error-handling]="Error Handling"
TITLES[migration]="Migration Guide"
TITLES[migration-per-service]="Integration Checklist"
TITLES[deployment-pm2]="PM2 Deployment"
TITLES[sdk-deployment]="SDK Publishing"
TITLES[architecture]="How It Works"
TITLES[architecture-decisions]="Architecture Decisions"
TITLES[sdk-explained]="SDK Internals"
TITLES[troubleshooting]="Troubleshooting & FAQ"
TITLES[standalone]="Standalone Mode"
TITLES[instrumentations]="Instrumentations"
TITLES[alerting]="Alerting & Monitoring"
TITLES[testing]="Testing"
TITLES[CHANGELOG]="Changelog"

SLUGS=(README getting-started configuration standalone logging tracing metrics error-handling instrumentations alerting migration migration-per-service deployment-pm2 sdk-deployment architecture architecture-decisions sdk-explained troubleshooting testing CHANGELOG)
OUT_NAMES=(index getting-started configuration standalone logging tracing metrics error-handling instrumentations alerting migration migration-per-service deployment-pm2 sdk-deployment architecture architecture-decisions sdk-explained troubleshooting testing CHANGELOG)

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
