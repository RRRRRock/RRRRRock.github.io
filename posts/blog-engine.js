(function () {
  const OWNER = 'ViperHua';
  const REPO = 'RRRRRock.github.io';
  const POSTS_DIR = 'posts';
  const BRANCH = 'main';

  const FALLBACK_FILES = [
    './posts/multi-chain-indexing.md',
    './posts/golang-latency-tuning.md',
    './posts/java-idempotency-consistency.md'
  ];

  function parseFrontMatter(markdown) {
    const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) return { meta: {}, content: markdown };

    const meta = {};
    match[1].split('\n').forEach((line) => {
      const idx = line.indexOf(':');
      if (idx === -1) return;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      meta[key] = value;
    });

    return {
      meta,
      content: markdown.slice(match[0].length)
    };
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
    return text.slice(0, 88) + (text.length > 88 ? '...' : '');
  }

  function filenameToSlug(path) {
    const name = path.split('/').pop() || '';
    return name.replace(/\.md$/i, '');
  }

  function tagClass(tag) {
    const t = (tag || '').toLowerCase();
    if (t.includes('web3')) return 'web3';
    if (t.includes('golang') || t.includes('go')) return 'golang';
    if (t.includes('java')) return 'java';
    return 'web3';
  }

  async function listMarkdownFiles() {
    const api = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${POSTS_DIR}?ref=${BRANCH}`;
    const resp = await fetch(api, { headers: { Accept: 'application/vnd.github+json' } });
    if (!resp.ok) throw new Error(`List posts failed: ${resp.status}`);
    const items = await resp.json();
    return items
      .filter((item) => item.type === 'file' && /\.md$/i.test(item.name))
      .map((item) => ({ path: item.path, download_url: item.download_url }));
  }

  async function loadMarkdown(pathOrUrl) {
    const resp = await fetch(pathOrUrl, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`Load markdown failed: ${resp.status}`);
    return resp.text();
  }

  async function loadPosts() {
    let files = [];
    try {
      files = await listMarkdownFiles();
    } catch (err) {
      files = FALLBACK_FILES.map((f) => ({ path: f, download_url: f }));
    }

    const posts = [];
    for (const file of files) {
      const md = await loadMarkdown(file.download_url || file.path);
      const { meta, content } = parseFrontMatter(md);
      const slug = meta.slug || filenameToSlug(file.path);
      posts.push({
        slug,
        title: meta.title || slug,
        date: meta.date || '',
        tag: meta.tag || 'Tech',
        excerpt: meta.excerpt || simpleExcerpt(content),
        content
      });
    }

    posts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return posts;
  }

  async function findPostBySlug(slug) {
    const posts = await loadPosts();
    return {
      posts,
      current: posts.find((p) => p.slug === slug) || posts[0] || null
    };
  }

  function renderMarkdown(md) {
    // Basic markdown renderer for headings/paragraph/list/code without external deps.
    const lines = md.replace(/\r\n/g, '\n').split('\n');
    let html = '';
    let inCode = false;
    let inUl = false;

    const esc = (s) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const inline = (s) =>
      esc(s)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    for (const raw of lines) {
      const line = raw.trim();

      if (line.startsWith('```')) {
        if (!inCode) {
          inCode = true;
          if (inUl) {
            html += '</ul>';
            inUl = false;
          }
          html += '<pre><code>';
        } else {
          inCode = false;
          html += '</code></pre>';
        }
        continue;
      }

      if (inCode) {
        html += esc(raw) + '\n';
        continue;
      }

      if (!line) {
        if (inUl) {
          html += '</ul>';
          inUl = false;
        }
        continue;
      }

      const h = line.match(/^(#{1,3})\s+(.*)$/);
      if (h) {
        if (inUl) {
          html += '</ul>';
          inUl = false;
        }
        const level = h[1].length;
        html += `<h${level}>${inline(h[2])}</h${level}>`;
        continue;
      }

      const li = line.match(/^[-*]\s+(.*)$/);
      if (li) {
        if (!inUl) {
          html += '<ul>';
          inUl = true;
        }
        html += `<li>${inline(li[1])}</li>`;
        continue;
      }

      if (inUl) {
        html += '</ul>';
        inUl = false;
      }
      html += `<p>${inline(line)}</p>`;
    }

    if (inUl) html += '</ul>';
    if (inCode) html += '</code></pre>';
    return html;
  }

  function buildTocAndAnchor(container) {
    const toc = [];
    const headings = container.querySelectorAll('h2, h3');
    headings.forEach((h, index) => {
      const text = (h.textContent || '').trim();
      const id = `sec-${index + 1}`;
      h.id = id;
      toc.push({ id, text, level: h.tagName.toLowerCase() });
    });
    return toc;
  }

  window.BlogEngine = {
    loadPosts,
    findPostBySlug,
    parseFrontMatter,
    renderMarkdown,
    buildTocAndAnchor,
    tagClass
  };
})();
