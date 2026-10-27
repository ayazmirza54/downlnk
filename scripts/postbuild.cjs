'use strict';

const { chmodSync, copyFileSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '..');
const dest = resolve(root, 'dist/cli.cjs');

copyFileSync(resolve(root, 'scripts/cli-entry.cjs'), dest);

// chmod is a no-op on Windows and npm re-applies bin permissions on install,
// so a failure here warns rather than failing the build.
try {
  chmodSync(dest, 0o755);
} catch (err) {
  console.warn('postbuild: could not set executable bit on dist/cli.cjs:', err.message);
}

console.log('postbuild: wrote dist/cli.cjs');
