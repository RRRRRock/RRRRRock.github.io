import fs from 'node:fs/promises';
import path from 'node:path';
import CleanCSS from 'clean-css';
import { minify as minifyHtml } from 'html-minifier-terser';
import { minify as terserMinify } from 'terser';
import JavaScriptObfuscator from 'javascript-obfuscator';

const root = process.cwd();
const srcPath = path.join(root, 'index.src.html');
const outPath = path.join(root, 'index.html');

function extractBlock(content, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = content.match(re);
  if (!match) throw new Error(`Cannot find <${tag}> block in index.src.html`);
  return match[1];
}

function replaceBlock(content, tag, replacement) {
  const re = new RegExp(`(<${tag}>)([\\s\\S]*?)(<\\/${tag}>)`, 'i');
  return content.replace(re, `$1${replacement}$3`);
}

function extractBodyContent(content) {
  const match = content.match(/<body>([\s\S]*?)<\/body>/i);
  if (!match) throw new Error('Cannot find <body> block in index.src.html');
  return match[1];
}

function utf8ToBase64(input) {
  return Buffer.from(input, 'utf8').toString('base64');
}

function createBootstrapJs(encodedCss, encodedBody, runtimeJs) {
  return `
(() => {
  const d = document;
  const decode = (b64) =>
    decodeURIComponent(
      atob(b64)
        .split('')
        .map((ch) => '%' + ('00' + ch.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );

  const style = d.createElement('style');
  style.textContent = decode('${encodedCss}');
  d.head.appendChild(style);

  d.body.innerHTML = decode('${encodedBody}');

  ${runtimeJs}
})();
`;
}

async function build() {
  const source = await fs.readFile(srcPath, 'utf8');
  const headMatch = source.match(/<head>([\s\S]*?)<\/head>/i);
  if (!headMatch) throw new Error('Cannot find <head> block in index.src.html');
  const cssRaw = extractBlock(source, 'style');
  const jsRaw = extractBlock(source, 'script');
  const bodyRaw = extractBodyContent(source);
  const bodyWithoutScript = bodyRaw.replace(/<script>[\s\S]*<\/script>/i, '').trim();

  const cssMin = new CleanCSS({ level: 2 }).minify(cssRaw);
  if (cssMin.errors.length) throw new Error(cssMin.errors.join('; '));

  const jsMin = await terserMinify(jsRaw, {
    compress: {
      passes: 2,
      drop_console: true,
      ecma: 2020
    },
    mangle: true,
    format: { comments: false }
  });

  if (!jsMin.code) throw new Error('Terser minification failed: empty output');

  const bodyMin = await minifyHtml(bodyWithoutScript, {
    collapseWhitespace: true,
    removeComments: true,
    removeAttributeQuotes: false,
    minifyCSS: false,
    minifyJS: false
  });

  const bootstrapJs = createBootstrapJs(
    utf8ToBase64(cssMin.styles),
    utf8ToBase64(bodyMin),
    jsMin.code
  );

  const jsObf = JavaScriptObfuscator.obfuscate(bootstrapJs, {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.75,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.35,
    disableConsoleOutput: true,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: true,
    rotateStringArray: true,
    selfDefending: true,
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 7,
    stringArray: true,
    stringArrayCallsTransform: true,
    stringArrayEncoding: ['base64'],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 2,
    stringArrayWrappersChainedCalls: true,
    stringArrayWrappersParametersMaxCount: 4,
    stringArrayWrappersType: 'function',
    unicodeEscapeSequence: false
  }).getObfuscatedCode();

  const headWithoutStyle = headMatch[1].replace(/<style>[\s\S]*<\/style>/i, '').trim();
  const skeleton = `<!doctype html><html lang="zh-CN"><head>${headWithoutStyle}</head><body><noscript>请启用 JavaScript 以查看此页面。</noscript><script>${jsObf}</script></body></html>`;

  const htmlMinified = await minifyHtml(skeleton, {
    collapseWhitespace: true,
    removeComments: true,
    removeAttributeQuotes: false,
    useShortDoctype: true,
    minifyCSS: false,
    minifyJS: false,
    sortAttributes: true,
    sortClassName: true
  });

  await fs.writeFile(outPath, htmlMinified, 'utf8');
  console.log('Obfuscated build generated: index.html');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
