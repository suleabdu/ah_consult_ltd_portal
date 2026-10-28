#!/usr/bin/env node
/**
 * Undefined-name lint for the static pages. A plain syntax check cannot see a call to a function that was never
 * defined (that is exactly how "compress is not defined" shipped), so this loads each page's scripts in page order
 * (external files then inline blocks) and runs ESLint's no-undef over the combined program. It also checks that every
 * inline event handler (onclick="save()") calls a function that exists.
 * Usage: node scripts/lint-pages.mjs        (exit code 1 on any finding)
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import globals from "globals";

const FRONT = join(dirname(fileURLToPath(import.meta.url)), "..", "frontend");
const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [{
    languageOptions: { ecmaVersion: 2023, sourceType: "script", globals: { ...globals.browser, supabase: "readonly", readXlsxFile: "readonly", AHOfficialDocuments: "readonly" } },
    rules: { "no-undef": "error", "no-redeclare": "error", "no-dupe-keys": "error", "no-unreachable": "error" },
  }],
});
const KEYWORDS = new Set("if else for while switch return function typeof new this event catch alert confirm prompt setTimeout setInterval clearTimeout parseInt parseFloat Number String Boolean Array Object JSON Math Date window document location history navigator console fetch URL FormData encodeURIComponent decodeURIComponent isNaN".split(" "));
let findings = 0, pages = 0;

for (const file of readdirSync(FRONT).filter((f) => f.endsWith(".html")).sort()) {
  const html = readFileSync(join(FRONT, file), "utf8");
  const parts = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1], src = /src="([^"]+)"/.exec(attrs);
    if (/json/i.test(attrs)) continue;
    if (src) { if (/^(js|vendor)\//.test(src[1]) && !src[1].startsWith("vendor/")) parts.push(readFileSync(join(FRONT, src[1].split("?")[0]), "utf8")); }
    else if (m[2].trim()) parts.push(m[2]);
  }
  if (!parts.length) continue;
  pages++;
  const program = parts.join("\n;\n");
  const winGlobals = Object.fromEntries([...program.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)].map((m) => [m[1], "writable"]));
  const linter = new ESLint({ overrideConfigFile: true, overrideConfig: [{ languageOptions: { ecmaVersion: 2023, sourceType: "script", globals: { ...globals.browser, supabase: "readonly", readXlsxFile: "readonly", AHOfficialDocuments: "readonly", ...winGlobals } }, rules: { "no-undef": "error", "no-redeclare": "error", "no-dupe-keys": "error", "no-unreachable": "error" } }] });
  const [res] = await linter.lintText(program, { filePath: file.replace(/\.html$/, ".js") });
  for (const msg of res.messages) { findings++; console.log(`  ${file}: ${msg.ruleId ?? "parse"}  ${msg.message}  (combined line ${msg.line})`); }
  const declared = new Set(Object.keys(winGlobals).concat([...program.matchAll(/\b(?:function\s*\*?\s*|const\s+|let\s+|var\s+)([A-Za-z_$][\w$]*)/g)].map((m) => m[1])));
  const missing = new Set();
  for (const h of html.matchAll(/\son[a-z]+\s*=\s*"([^"]*)"/gi))
    for (const c of h[1].matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g))
      if (!KEYWORDS.has(c[1]) && !declared.has(c[1]) && !(c[1] in globals.browser)) missing.add(c[1]);
  for (const name of missing) { findings++; console.log(`  ${file}: inline handler calls undefined function ${name}()`); }
}
console.log(findings ? `\n${findings} problem(s) in ${pages} pages` : `OK: ${pages} pages, no undefined names`);
process.exit(findings ? 1 : 0);
