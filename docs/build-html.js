#!/usr/bin/env node
const { marked } = require('marked');
const fs = require('fs');
const path = require('path');

const docsDir = __dirname;
const outDir = path.join(docsDir, 'html');

const pages = [
  { file: 'README.md', title: 'Documentation Home', slug: 'index' },
  { file: 'architecture.md', title: 'Architecture', slug: 'architecture' },
  { file: 'architecture-decisions.md', title: 'Architecture Decisions', slug: 'architecture-decisions' },
  { file: 'getting-started.md', title: 'Getting Started', slug: 'getting-started' },
  { file: 'tracing.md', title: 'Distributed Tracing', slug: 'tracing' },
  { file: 'migration.md', title: 'Migration Guide', slug: 'migration' },
  { file: 'migration-per-service.md', title: 'Service Migration Reference', slug: 'migration-per-service' },
  { file: 'deployment-pm2.md', title: 'Deployment', slug: 'deployment-pm2' },
  { file: 'sdk-explained.md', title: 'SDK Internals', slug: 'sdk-explained' },
  { file: 'sdk-deployment.md', title: 'SDK Deployment', slug: 'sdk-deployment' },
];

const nav = pages.map(p =>
  `<a href="${p.slug}.html">${p.title}</a>`
).join('\n        ');

function template(title, body, currentSlug) {
  const navWithActive = pages.map(p =>
    `<a href="${p.slug}.html"${p.slug === currentSlug ? ' class="active"' : ''}>${p.title}</a>`
  ).join('\n          ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — @brdrwanda/observability</title>
  <style>
    :root {
      --bg: #ffffff;
      --text: #1a1a2e;
      --muted: #6b7280;
      --border: #e5e7eb;
      --accent: #2563eb;
      --accent-light: #eff6ff;
      --sidebar-bg: #f8fafc;
      --code-bg: #f1f5f9;
      --code-block-bg: #0f172a;
      --code-block-text: #e2e8f0;
      --success: #059669;
      --warn: #d97706;
      --error: #dc2626;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
      color: var(--text);
      background: var(--bg);
      line-height: 1.7;
      display: flex;
      min-height: 100vh;
    }

    .sidebar {
      width: 280px;
      min-height: 100vh;
      background: var(--sidebar-bg);
      border-right: 1px solid var(--border);
      padding: 24px 0;
      position: fixed;
      top: 0;
      left: 0;
      overflow-y: auto;
      z-index: 10;
    }

    .sidebar-header {
      padding: 0 20px 20px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 12px;
    }

    .sidebar-header h2 {
      font-size: 15px;
      font-weight: 700;
      color: var(--accent);
      letter-spacing: -0.02em;
    }

    .sidebar-header p {
      font-size: 12px;
      color: var(--muted);
      margin-top: 4px;
    }

    .sidebar a {
      display: block;
      padding: 8px 20px;
      color: var(--muted);
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.15s;
      border-left: 3px solid transparent;
    }

    .sidebar a:hover {
      color: var(--text);
      background: var(--accent-light);
    }

    .sidebar a.active {
      color: var(--accent);
      border-left-color: var(--accent);
      background: var(--accent-light);
      font-weight: 600;
    }

    .content {
      flex: 1;
      margin-left: 280px;
      max-width: 900px;
      padding: 48px 60px 80px;
    }

    h1 {
      font-size: 32px;
      font-weight: 800;
      letter-spacing: -0.03em;
      margin-bottom: 8px;
      color: var(--text);
      line-height: 1.2;
    }

    h2 {
      font-size: 22px;
      font-weight: 700;
      margin-top: 48px;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
      letter-spacing: -0.02em;
    }

    h3 {
      font-size: 17px;
      font-weight: 600;
      margin-top: 32px;
      margin-bottom: 12px;
    }

    h4 {
      font-size: 15px;
      font-weight: 600;
      margin-top: 24px;
      margin-bottom: 8px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    p { margin-bottom: 16px; font-size: 15px; }

    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }

    code {
      font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', Consolas, monospace;
      font-size: 13px;
      background: var(--code-bg);
      padding: 2px 6px;
      border-radius: 4px;
    }

    pre {
      background: var(--code-block-bg);
      color: var(--code-block-text);
      padding: 20px 24px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 16px 0 24px;
      line-height: 1.5;
    }

    pre code {
      background: none;
      padding: 0;
      color: inherit;
      font-size: 13px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0 24px;
      font-size: 14px;
    }

    th {
      text-align: left;
      padding: 10px 14px;
      background: var(--sidebar-bg);
      border: 1px solid var(--border);
      font-weight: 600;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
    }

    td {
      padding: 10px 14px;
      border: 1px solid var(--border);
      vertical-align: top;
    }

    tr:hover td { background: var(--accent-light); }

    ul, ol {
      padding-left: 24px;
      margin-bottom: 16px;
    }

    li {
      margin-bottom: 6px;
      font-size: 15px;
    }

    blockquote {
      border-left: 3px solid var(--accent);
      padding: 12px 20px;
      margin: 16px 0;
      background: var(--accent-light);
      border-radius: 0 6px 6px 0;
      font-size: 14px;
      color: var(--muted);
    }

    blockquote p { margin-bottom: 0; }

    hr {
      border: none;
      border-top: 1px solid var(--border);
      margin: 40px 0;
    }

    strong { font-weight: 600; }

    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
    }

    @media (max-width: 900px) {
      .sidebar { display: none; }
      .content { margin-left: 0; padding: 24px; }
    }

    @media print {
      .sidebar { display: none; }
      .content { margin-left: 0; max-width: 100%; }
    }
  </style>
</head>
<body>
  <nav class="sidebar">
    <div class="sidebar-header">
      <h2>@brdrwanda/observability</h2>
      <p>SDK Documentation</p>
    </div>
    <div class="sidebar-nav">
      ${navWithActive}
    </div>
  </nav>
  <main class="content">
    ${body}
  </main>
</body>
</html>`;
}

marked.setOptions({
  gfm: true,
  breaks: false,
  headerIds: true,
});

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

for (const page of pages) {
  const md = fs.readFileSync(path.join(docsDir, page.file), 'utf8');

  let processed = md.replace(/\[([^\]]+)\]\(([^)]+)\.md\)/g, (_, text, href) => {
    return `[${text}](${href}.html)`;
  });

  const html = marked.parse(processed);
  const full = template(page.title, html, page.slug);
  const outPath = path.join(outDir, `${page.slug}.html`);
  fs.writeFileSync(outPath, full);
  console.log(`  ✓ ${page.slug}.html`);
}

console.log(`\nDone. ${pages.length} pages generated in docs/html/`);
