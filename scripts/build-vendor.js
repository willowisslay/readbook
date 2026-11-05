import {copyFileSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
mkdirSync(new URL('public/vendor/',root),{recursive:true});
copyFileSync(new URL('node_modules/marked/lib/marked.esm.js',root),new URL('public/vendor/marked.js',root));
copyFileSync(new URL('node_modules/dompurify/dist/purify.es.mjs',root),new URL('public/vendor/purify.js',root));
writeFileSync(new URL('public/vendor/LICENSES.txt',root),['marked','dompurify'].map(name=>`${name}\n${readFileSync(new URL(`node_modules/${name}/LICENSE`,root),'utf8')}`).join('\n\n'));
