/*
 * 관리자 미리보기: 저장하기 전에 목록 카드와 상세 페이지가 어떻게 보일지 그린다.
 * 실제 페이지와 같은 글꼴·색·본문 스타일(.prose / .rich)을 쓴다.
 */
export interface PreviewData {
  kind: string; // research | design | writing | drawing
  title: string;
  subtitle: string;
  date: string; // YYYY-MM-DD
  period: string;
  summary: string;
  tags: string[];
  role: string;
  tools: string[];
  thumbUrl: string | null;
  thumbAlt: string;
  images: { url: string; size: string }[];
  bodyHtml: string;
}

const EN: Record<string, string> = { research: 'Research', design: 'Design', writing: 'Writing', drawing: 'Drawing' };
const KO: Record<string, string> = { research: '연구 포트폴리오', design: '디자인 포트폴리오', writing: '그 외 작업물', drawing: '그 외 작업물' };

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}
const img = (src: string, alt: string, cls = '') => Object.assign(h('img', cls), { src, alt });

export function renderPreview(root: HTMLElement, d: PreviewData) {
  const portfolio = d.kind === 'research' || d.kind === 'design';
  const dateText = d.date.replaceAll('-', '.');
  const period = d.period || d.date.slice(0, 7).replace('-', '.');
  const when = portfolio ? period : dateText;
  const title = d.title || '[제목]';

  // ── 목록 카드 ──
  const cardSec = h('section', 'pv-sec');
  cardSec.append(h('p', 'pixel-label pv-cap', 'List card'));
  const card = h('div', 'pv-card');
  const thumb = h('div', 'pv-thumb');
  thumb.append(d.thumbUrl ? img(d.thumbUrl, d.thumbAlt) : h('span', 'pv-placeholder'));
  const cb = h('div', 'pv-card-body');
  const meta = h('p', 'pv-meta');
  meta.append(h('span', 'pixel-label pv-accent', EN[d.kind] ?? ''), h('span', 'pixel-label', when));
  const ct = h('p', 'pv-card-title', title);
  if (portfolio && d.subtitle) ct.append(h('span', 'pv-sub', d.subtitle));
  cb.append(meta, ct);
  if (d.summary) cb.append(h('p', 'caption', d.summary));
  card.append(thumb, cb);
  cardSec.append(card);

  // ── 상세 페이지 ──
  const page = h('section', 'pv-sec');
  page.append(h('p', 'pixel-label pv-cap', 'Detail page'));
  const art = h('article', 'pv-page');
  art.append(h('p', 'pixel-label pv-back', `← ${KO[d.kind] ?? ''}`));
  const head = h('header', 'pv-head');
  head.append(h('p', 'pixel-label pv-accent', `${EN[d.kind] ?? ''} · ${when}`), h('h1', 'page-title', title));
  if (portfolio && d.subtitle) head.append(h('p', 'pv-subtitle', d.subtitle));
  if (d.summary) head.append(h('p', 'pv-lead', d.summary));
  const tags = () => {
    const ul = h('ul', 'pv-tags');
    d.tags.forEach((t) => ul.append(h('li', '', t)));
    return ul;
  };
  if (!portfolio && d.tags.length) head.append(tags());
  art.append(head);

  const body = h('div', 'prose pv-prose');
  body.innerHTML = d.bodyHtml;

  if (portfolio) {
    const layout = h('div', 'pv-layout');
    const facts = h('aside', 'pv-facts');
    const dl = h('dl');
    [
      ['기간', period],
      ['역할', d.role],
      ['도구', d.tools.join(', ')],
    ]
      .filter(([, v]) => v)
      .forEach(([k, v]) => {
        const row = h('div');
        row.append(h('dt', 'pixel-label', k), h('dd', '', v));
        dl.append(row);
      });
    facts.append(dl);
    if (d.tags.length) facts.append(tags());
    layout.append(facts, body);
    art.append(layout);
  } else {
    // 글: 썸네일을 표지로 / 그림: 그림 모음(없으면 썸네일)을 크게
    // 실제 페이지처럼: 그림 모음이 있으면 크게(크기 선택 반영), 그림 작업물은 없으면 썸네일을
    const figures = d.images.length ? d.images : d.kind === 'drawing' && d.thumbUrl ? [{ url: d.thumbUrl, size: 'original' }] : [];
    if (d.kind === 'writing' && d.thumbUrl) art.append(img(d.thumbUrl, d.thumbAlt, 'pv-cover'));
    figures.forEach((f, i) => {
      const el = img(f.url, `${title} ${i + 1}`, 'pv-figure');
      el.dataset.size = f.size;
      art.append(el);
    });
    art.append(body);
  }
  if (d.images.length && portfolio) {
    const g = h('section', 'pv-gallery');
    g.append(h('p', 'pixel-label', portfolio ? '이미지' : 'Images'));
    const ol = h('ol');
    d.images.forEach((f, i) => {
      const li = h('li');
      const el = img(f.url, `${title} 이미지 ${i + 1}`, 'pv-figure');
      el.dataset.size = f.size;
      li.append(el);
      ol.append(li);
    });
    g.append(ol);
    art.append(g);
  }
  page.append(art);
  root.replaceChildren(cardSec, page);
}

/**
 * 미리보기용 간단한 마크다운 → HTML (소제목·굵게·기울임·링크·그림·목록·인용·표·구분선).
 * 글자는 먼저 이스케이프한다. 실제 사이트의 마크다운 처리와 아주 조금 다를 수 있다.
 */
export function markdownToHtml(md: string, assetPrefix = '') {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const src = (u: string) => (u.startsWith('./') ? assetPrefix + encodeURIComponent(u.slice(2)) : u);
  const safeUrl = (u: string) => (/^(https?:|mailto:|\/|\.\/|#)/.test(u) ? u : '#');
  const inline = (s: string) =>
    esc(s)
      .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, alt, u) => `<img src="${src(safeUrl(u))}" alt="${alt}">`)
      .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, t, u) => `<a href="${safeUrl(u)}" target="_blank" rel="noopener noreferrer">${t}</a>`)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  const out: string[] = [];
  const blocks = md.replace(/\r/g, '').split(/\n{2,}/);
  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;
    const lines = block.split('\n');
    const m = block.match(/^(#{1,6})\s+(.*)$/);
    if (m && lines.length === 1) out.push(`<h${Math.max(2, Math.min(3, m[1].length))}>${inline(m[2])}</h${Math.max(2, Math.min(3, m[1].length))}>`);
    else if (/^(-{3,}|\*{3,})$/.test(block)) out.push('<hr>');
    else if (lines.every((l) => l.trim().startsWith('|'))) {
      const rows = lines.filter((l) => !/^\|?\s*:?-{2,}/.test(l.trim())).map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
      const [headRow, ...rest] = rows;
      out.push(
        `<table><thead><tr>${headRow.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rest
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`,
      );
    } else if (lines.every((l) => /^\s*[-*]\s+/.test(l))) out.push(`<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`);
    else if (lines.every((l) => /^\s*\d+\.\s+/.test(l))) out.push(`<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+\.\s+/, ''))}</li>`).join('')}</ol>`);
    else if (lines.every((l) => l.startsWith('>'))) out.push(`<blockquote><p>${lines.map((l) => inline(l.replace(/^>\s?/, ''))).join('<br>')}</p></blockquote>`);
    else if (m) out.push(`<h2>${inline(m[2])}</h2><p>${lines.slice(1).map(inline).join('<br>')}</p>`);
    else out.push(`<p>${lines.map(inline).join('<br>')}</p>`);
  }
  return out.join('\n');
}
