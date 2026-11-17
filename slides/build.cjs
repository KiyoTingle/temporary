const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');
const result = esbuild.buildSync({ entryPoints: ['slides/editor.js'], bundle: true, minify: true, outfile: 'slides/editor.bundle.js', format: 'iife', target: ['chrome110', 'safari16', 'firefox115'], legalComments: 'eof', metafile: true });
const directories = new Set();
for (const input of Object.keys(result.metafile.inputs).filter(file => file.startsWith('node_modules/'))) {
  let dir = path.dirname(input);
  while (!fs.existsSync(path.join(dir, 'package.json')) && dir !== '.') dir = path.dirname(dir);
  if (dir !== '.') directories.add(dir);
}
// Keep upstream notices alongside the checked-in static bundle.
const notices = [...directories].sort().map(dir => {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const license = fs.readdirSync(dir).find(file => /^licen[sc]e/i.test(file));
  return `${pkg.name} ${pkg.version}\n${license ? fs.readFileSync(`${dir}/${license}`, 'utf8') : `${pkg.license}; ${JSON.stringify(pkg.repository || '')}`}`;
});
fs.writeFileSync('slides/THIRD_PARTY_NOTICES.txt', notices.join('\n\n--------------------\n\n'));
