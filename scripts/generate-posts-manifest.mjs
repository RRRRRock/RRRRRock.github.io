import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const postsDir = path.join(root, 'posts');
const outFile = path.join(postsDir, 'posts-manifest.js');

function parseFrontMatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { meta: {}, content: markdown };

  const meta = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    meta[k] = v;
  }
  return { meta, content: markdown.slice(match[0].length) };
}

function simpleExcerpt(content) {
  const text = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/[>*_~\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, 96) + (text.length > 96 ? '...' : '');
}

async function buildManifest() {
  const files = await fs.readdir(postsDir);
  const mdFiles = files.filter((f) => f.endsWith('.md')).sort();

  const manifest = [];
  for (const file of mdFiles) {
    const full = path.join(postsDir, file);
    const md = await fs.readFile(full, 'utf8');
    const { meta, content } = parseFrontMatter(md);
    const slug = meta.slug || file.replace(/\.md$/i, '');
    manifest.push({
      slug,
      title: meta.title || slug,
      date: meta.date || '',
      tag: meta.tag || 'Tech',
      excerpt: meta.excerpt || simpleExcerpt(content),
      file: `./posts/${file}`
    });
  }

  manifest.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const out = `window.__POSTS_MANIFEST__ = ${JSON.stringify(manifest, null, 2)};\n`;
  await fs.writeFile(outFile, out, 'utf8');
  console.log(`Generated posts manifest: ${path.relative(root, outFile)} (${manifest.length} posts)`);
}

buildManifest().catch((err) => {
  console.error(err);
  process.exit(1);
});
