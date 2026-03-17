(function () {
  const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

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

  function tagClass(tag) {
    const t = (tag || '').toLowerCase();
    if (t.includes('web3')) return 'web3';
    if (t.includes('golang') || t.includes('go')) return 'golang';
    if (t.includes('java')) return 'java';
    return 'web3';
  }

  async function loadManifest() {
    if (Array.isArray(window.__POSTS_MANIFEST__) && window.__POSTS_MANIFEST__.length) {
      return window.__POSTS_MANIFEST__;
    }

    const code = await fetchTextCached('./posts/posts-manifest.js', CACHE_TTL_MS);
    // eslint-disable-next-line no-new-func
    new Function(code)();

    if (!Array.isArray(window.__POSTS_MANIFEST__)) {
      throw new Error('Manifest parse failed');
    }
    return window.__POSTS_MANIFEST__;
  }

  async function loadPosts() {
    const posts = await loadManifest();
    return [...posts].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }

  async function findPostBySlug(slug) {
    const posts = await loadPosts();
    const currentMeta = posts.find((p) => p.slug === slug) || posts[0] || null;
    if (!currentMeta) return { posts, current: null };

    const md = await fetchTextCached(currentMeta.file, CACHE_TTL_MS);
    const { meta, content } = parseFrontMatter(md);

    return {
      posts,
      current: {
        ...currentMeta,
        ...meta,
        content
      }
    };
  }

  function renderMarkdown(md) {
    if (window.marked && typeof window.marked.parse === 'function') {
      window.marked.setOptions({
        gfm: true,
        breaks: true
      });

      const rawHtml = window.marked.parse(md || '');
      if (window.DOMPurify && typeof window.DOMPurify.sanitize === 'function') {
        return window.DOMPurify.sanitize(rawHtml, {
          USE_PROFILES: { html: true }
        });
      }
      return rawHtml;
    }

    const lines = md.replace(/\r\n/g, '\n').split('\n');
    let html = '';
    let inCode = false;
    let inUl = false;

    const esc = (s) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const inline = (s) =>
      esc(s)
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy" decoding="async" />')
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

  function cacheKey(url) {
    return `blog_cache:${url}`;
  }

  function getCached(url, ttl) {
    try {
      const raw = localStorage.getItem(cacheKey(url));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      if (!parsed.time || !parsed.text) return null;
      if (Date.now() - parsed.time > ttl) return null;
      return parsed.text;
    } catch (_err) {
      return null;
    }
  }

  function setCached(url, text) {
    try {
      localStorage.setItem(cacheKey(url), JSON.stringify({ time: Date.now(), text }));
    } catch (_err) {
      // Ignore storage failures (private mode / quota exceeded).
    }
  }

  async function fetchTextCached(url, ttl) {
    const hit = getCached(url, ttl);
    if (hit) return hit;
    const resp = await fetch(url, { cache: 'force-cache' });
    if (!resp.ok) throw new Error(`Fetch failed: ${resp.status} (${url})`);
    const text = await resp.text();
    setCached(url, text);
    return text;
  }

  async function warmupPostCache(limit) {
    try {
      const posts = await loadPosts();
      const count = Math.max(0, Math.min(posts.length, typeof limit === 'number' ? limit : 3));
      await Promise.all(
        posts.slice(0, count).map(async (p) => {
          await fetchTextCached(p.file, CACHE_TTL_MS);
        })
      );
    } catch (_err) {
      // warmup is best-effort only
    }
  }

  window.BlogEngine = {
    loadPosts,
    findPostBySlug,
    parseFrontMatter,
    renderMarkdown,
    buildTocAndAnchor,
    tagClass,
    warmupPostCache
  };
})();
