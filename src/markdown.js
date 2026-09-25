// Minimal Markdown -> HTML for Productive comments (ProseMirror HTML): headings, paragraphs,
// bold/italic/inline code, ordered + unordered lists, fenced code, links. Input that already
// looks like HTML is returned untouched.

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const inline = (s) =>
  escapeHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/(^|[\s(])((https?:\/\/)[^\s<)]+)/g, '$1<a href="$2">$2</a>');

export const looksLikeHtml = (s) => /<\s*(p|div|ul|ol|li|strong|em|br|h[1-6]|code|pre|a)\b[^>]*>/i.test(s);

export function markdownToHtml(md) {
  if (!md || looksLikeHtml(md)) return md;
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let para = [], list = null, code = null;

  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; } };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (code) {
      if (/^```/.test(line)) { out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`); code = null; }
      else code.push(raw);
      continue;
    }
    if (/^```/.test(line)) { flushPara(); flushList(); code = []; continue; }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushPara(); flushList(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const tag = ul ? "ul" : "ol";
      if (!list || list.tag !== tag) { flushList(); list = { tag, items: [] }; }
      list.items.push((ul || ol)[1]);
      continue;
    }
    if (list && /^\s{2,}\S/.test(raw)) { list.items[list.items.length - 1] += " " + line.trim(); continue; } // list continuation
    flushList();
    // a bold-only line ("**Vad som är gjort**") reads as a heading in Productive
    if (/^\*\*[^*]+\*\*:?$/.test(line.trim())) { flushPara(); out.push(`<p><strong>${escapeHtml(line.trim().replace(/^\*\*|\*\*:?$/g, ""))}</strong></p>`); continue; }
    para.push(line);
  }
  flushPara(); flushList();
  if (code) out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  return out.join("");
}
