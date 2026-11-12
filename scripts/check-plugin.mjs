// Checks the manifest and the built plugin before it goes to Figma:
// the fields Figma needs, network access limited to the Wiro AI hosts the
// plugin calls, and a self-contained UI (no external scripts or styles).
//
// node scripts/check-plugin.mjs    (after npm run build)

import { readFile, stat } from 'node:fs/promises';

const ALLOWED_DOMAINS = ['https://mcp.wiro.ai', 'https://cdn1.wiro.ai'];
const problems = [];
const check = (ok, message) => {
  if (!ok) problems.push(message);
};

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
check(typeof manifest.name === 'string' && manifest.name.length > 0, 'manifest.name is missing.');
check(!/fig/i.test(manifest.name), 'manifest.name must not contain "Figma" or "Fig" (Figma Community guidelines).');
check(manifest.api === '1.0.0', 'manifest.api must be "1.0.0".');
check(
  Array.isArray(manifest.editorType) && manifest.editorType.includes('figma'),
  'manifest.editorType must include "figma".',
);
check(manifest.documentAccess === 'dynamic-page', 'manifest.documentAccess must be "dynamic-page".');
check(manifest.id === undefined || /^\d+$/.test(manifest.id), 'manifest.id must be the numeric id Figma generates.');

const domains = manifest.networkAccess?.allowedDomains;
check(Array.isArray(domains), 'manifest.networkAccess.allowedDomains is missing.');
if (Array.isArray(domains)) {
  check(
    domains.length === ALLOWED_DOMAINS.length && ALLOWED_DOMAINS.every((domain) => domains.includes(domain)),
    `manifest.networkAccess.allowedDomains must be exactly ${ALLOWED_DOMAINS.join(', ')}.`,
  );
  check(!domains.some((domain) => domain.includes('*')), 'allowedDomains must not use wildcards.');
}
check(
  typeof manifest.networkAccess?.reasoning === 'string' && manifest.networkAccess.reasoning.length > 20,
  'manifest.networkAccess.reasoning should say why the plugin calls these hosts.',
);

for (const field of ['main', 'ui']) {
  const file = manifest[field];
  try {
    const info = await stat(file);
    check(info.size > 0, `${file} is empty.`);
  } catch {
    problems.push(`${file} (manifest.${field}) does not exist. Run npm run build.`);
  }
}

try {
  const html = await readFile(manifest.ui, 'utf8');
  check(!/<script[^>]+src=/i.test(html), 'dist/ui.html loads an external script; Figma needs it inline.');
  check(!/<link[^>]+stylesheet/i.test(html), 'dist/ui.html loads an external stylesheet; Figma needs it inline.');
  check(html.includes('https://mcp.wiro.ai/v1'), 'dist/ui.html does not call the Wiro AI MCP endpoint.');
  const hosts = new Set(
    [...html.matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)].map((match) => match[1].toLowerCase()),
  );
  for (const host of hosts) {
    const called = ALLOWED_DOMAINS.some((domain) => domain === `https://${host}`);
    // wiro.ai pages are opened in the browser with figma.openExternal, not fetched.
    check(called || host === 'wiro.ai', `dist/ui.html mentions ${host}, which is not in allowedDomains.`);
  }
} catch {
  // Reported above.
}

try {
  const code = await readFile(manifest.main, 'utf8');
  check(!/\bfetch\(/.test(code), 'dist/code.js calls fetch; network calls belong in the UI.');
  check(
    !/getNodeById\(|getStyleById\(|\.currentPage\s*=[^=]/.test(code),
    'dist/code.js uses an API that dynamic-page forbids.',
  );
} catch {
  // Reported above.
}

if (problems.length > 0) {
  console.error(`Plugin check failed:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`Plugin check passed: ${manifest.name}, network access ${domains.join(', ')}.`);
