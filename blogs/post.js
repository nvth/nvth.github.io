(() => {
  const config = window.BLOG_POST_CONFIG;
  const article = document.getElementById("article");
  const tocLinks = document.getElementById("toc-links");
  const postTitle = document.getElementById("post-title");
  const postDek = document.getElementById("post-dek");
  const heroMeta = document.getElementById("hero-meta");
  const rawMdLink = document.getElementById("raw-md-link");
  const langButtons = document.querySelectorAll(".lang-btn");

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function safeUrl(value) {
    const url = String(value).trim();
    return /^(?:javascript|data|vbscript):/i.test(url) ? "#" : url;
  }

  function slugify(value) {
    return String(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "section";
  }

  function inlineMarkdown(value) {
    let html = escapeHtml(value);
    html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, alt, url) =>
      '<img src="' + escapeHtml(safeUrl(url)) + '" alt="' + escapeHtml(alt) + '">'
    );
    html = html.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label, url) =>
      '<a href="' + escapeHtml(safeUrl(url)) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>'
    );
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    return html;
  }

  function codeBlock(code, lang) {
    const label = lang ? escapeHtml(lang) : "text";
    return [
      '<div class="code-wrap">',
      '<div class="code-head"><span class="dot dot-r"></span><span class="dot dot-y"></span><span class="dot dot-g"></span><span style="margin-left:auto">' + label + '</span></div>',
      "<pre><code>" + escapeHtml(code.replace(/\n$/, "")) + "</code></pre>",
      "</div>"
    ].join("");
  }

  function markdownToSections(markdown) {
    const lines = markdown.replace(/\r\n/g, "\n").split("\n");
    const sections = [];
    let current = { title: "", id: "intro", html: [] };
    let paragraph = [];
    let list = null;
    let table = null;
    let inCode = false;
    let codeLang = "";
    let codeLines = [];

    function flushParagraph() {
      if (!paragraph.length) return;
      current.html.push("<p>" + inlineMarkdown(paragraph.join(" ")) + "</p>");
      paragraph = [];
    }

    function flushList() {
      if (!list) return;
      current.html.push("<" + list.type + ">" + list.items.map(item => "<li>" + inlineMarkdown(item) + "</li>").join("") + "</" + list.type + ">");
      list = null;
    }

    function flushTable() {
      if (!table || !table.rows.length) { table = null; return; }
      const header = table.rows[0];
      const body = table.rows.slice(1);
      current.html.push(
        '<div class="table-wrap"><table><thead><tr>' +
        header.map(cell => "<th>" + inlineMarkdown(cell) + "</th>").join("") +
        "</tr></thead><tbody>" +
        body.map(row => "<tr>" + row.map(cell => "<td>" + inlineMarkdown(cell) + "</td>").join("") + "</tr>").join("") +
        "</tbody></table></div>"
      );
      table = null;
    }

    function pushSection() {
      flushParagraph();
      flushList();
      flushTable();
      if (current.title || current.html.length) sections.push(current);
    }

    for (const line of lines) {
      const fence = line.match(/^```(\w+)?\s*$/);
      if (fence) {
        if (inCode) {
          current.html.push(codeBlock(codeLines.join("\n"), codeLang));
          inCode = false;
          codeLang = "";
          codeLines = [];
        } else {
          flushParagraph();
          flushList();
          inCode = true;
          codeLang = fence[1] || "";
        }
        continue;
      }
      if (inCode) { codeLines.push(line); continue; }

      const tableRow = line.match(/^\|(.+)\|\s*$/);
      if (tableRow) {
        flushParagraph();
        flushList();
        const cells = tableRow[1].split("|").map(cell => cell.trim());
        if (!cells.every(cell => /^:?-{3,}:?$/.test(cell))) {
          if (!table) table = { rows: [] };
          table.rows.push(cells);
        }
        continue;
      }
      flushTable();

      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        if (heading[1].length === 3) {
          flushParagraph();
          flushList();
          current.html.push("<h3>" + inlineMarkdown(heading[2]) + "</h3>");
        } else {
          pushSection();
          current = { title: heading[2], id: slugify(heading[2]), html: [] };
        }
        continue;
      }

      if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
        flushParagraph();
        flushList();
        current.html.push("<hr>");
        continue;
      }

      const ul = line.match(/^\s*[-*]\s+(.+)$/);
      if (ul) {
        flushParagraph();
        if (!list || list.type !== "ul") { flushList(); list = { type: "ul", items: [] }; }
        list.items.push(ul[1]);
        continue;
      }

      const ol = line.match(/^\s*\d+\.\s+(.+)$/);
      if (ol) {
        flushParagraph();
        if (!list || list.type !== "ol") { flushList(); list = { type: "ol", items: [] }; }
        list.items.push(ol[1]);
        continue;
      }

      const quote = line.match(/^>\s+(.+)$/);
      if (quote) {
        flushParagraph();
        flushList();
        current.html.push("<blockquote>" + inlineMarkdown(quote[1]) + "</blockquote>");
        continue;
      }

      if (!line.trim()) { flushParagraph(); flushList(); continue; }
      paragraph.push(line.trim());
    }

    if (inCode) current.html.push(codeBlock(codeLines.join("\n"), codeLang));
    pushSection();
    return sections;
  }

  function render(markdown) {
    const sections = markdownToSections(markdown);
    const seen = new Map();
    const html = sections.map(section => {
      let id = section.id;
      if (seen.has(id)) {
        const next = seen.get(id) + 1;
        seen.set(id, next);
        id += "-" + next;
      } else {
        seen.set(id, 1);
      }
      section.id = id;
      const heading = section.title ? "<h2>" + inlineMarkdown(section.title) + "</h2>" : "";
      return '<section class="md-section" id="' + escapeHtml(id) + '">' + heading + section.html.join("") + "</section>";
    }).join("");

    article.innerHTML = html || '<div class="error">No content was found for this post.</div>';
    tocLinks.innerHTML = sections
      .filter(section => section.title)
      .map(section => '<a href="#' + escapeHtml(section.id) + '">' + inlineMarkdown(section.title) + "</a>")
      .join("");
  }

  function setLanguage(lang, updateUrl = true) {
    const selected = config.content[lang] ? lang : (config.defaultLang || "en");
    const content = config.content[selected];

    document.documentElement.lang = selected;
    document.title = content.browserTitle;
    document.querySelector('meta[name="description"]').setAttribute("content", content.description);
    postTitle.textContent = content.title;
    postDek.innerHTML = content.dek;
    heroMeta.innerHTML = content.meta.map(item => "<span>" + escapeHtml(item) + "</span>").join("") + '<span id="post-topic">' + escapeHtml(content.topic) + "</span>";
    rawMdLink.href = content.mdUrl;
    rawMdLink.textContent = content.rawLabel;
    article.innerHTML = '<div class="loading">' + escapeHtml(content.loading) + ' <code>' + escapeHtml(content.mdUrl) + "</code>...</div>";
    tocLinks.innerHTML = "";

    langButtons.forEach(button => {
      const active = button.dataset.lang === selected;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });

    if (updateUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set("lang", selected);
      history.replaceState(null, "", url);
    }

    fetch(content.mdUrl)
      .then(response => {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.text();
      })
      .then(render)
      .catch(error => {
        article.innerHTML = '<div class="error">Could not load Markdown from <code>' + escapeHtml(content.mdUrl) + "</code>. Open this page through a local server/GitHub Pages. Detail: " + escapeHtml(error.message) + "</div>";
      });
  }

  langButtons.forEach(button => button.addEventListener("click", () => setLanguage(button.dataset.lang)));
  const initialLang = new URLSearchParams(window.location.search).get("lang") || config.defaultLang || "en";
  setLanguage(initialLang, false);
})();
