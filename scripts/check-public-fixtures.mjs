import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const excludedDirectories = new Set([
  '.bundle', '.git', '.gradle', '.idea', '.cxx', 'build', 'node_modules', 'Pods', 'vendor',
]);
const excludedFiles = new Set(['.DS_Store', '.xcode.env.local', 'local.properties']);
const checks = [
  ['absolute user path', /(?:\/Users\/|\/home\/|[A-Z]:\\Users\\)/i],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['OpenAI-style secret key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['production UPI handle', /@[a-z0-9._-]*(?:okaxis|okhdfcbank|okicici|oksbi|ybl|ibl|paytm)\b/i],
  ['non-synthetic 12-digit fixture reference', /\b(?!900000\d{6}\b)\d{12}\b/],
];

const files = [];
const collect = path => {
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (!excludedDirectories.has(entry) && !excludedFiles.has(entry)) collect(join(path, entry));
    }
  } else if (
    path !== fileURLToPath(import.meta.url) &&
    /(?:\.(?:js|mjs|ts|tsx|kt|swift|md|xml|plist|json|ya?ml|gradle|properties|pro|sh)|Gemfile)$/.test(path)
  ) {
    files.push(path);
  }
};
collect(root);

const findings = [];
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const [label, pattern] of checks) {
      if (pattern.test(line)) findings.push(`${relative(root, file)}:${index + 1}: ${label}`);
    }
  });
}

if (findings.length) {
  console.error(`Public-fixture check failed:\n${findings.join('\n')}`);
  process.exit(1);
}
console.log(`Public-fixture check passed (${files.length} text files scanned).`);
