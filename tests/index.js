// `node --test tests/` entry point. Since Node 21 the positional argument of
// `node --test` is a file/glob, not a directory, so Node resolves "tests/" to
// this index.js; it loads every *.test.mjs file next to it.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

for (const f of fs.readdirSync(__dirname).filter((n) => n.endsWith('.test.mjs')).sort()) {
  import(pathToFileURL(path.join(__dirname, f)).href);
}
