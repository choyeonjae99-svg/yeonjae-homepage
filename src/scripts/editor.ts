/*
 * 관리자 페이지 본문 편집기 (Tiptap).
 * 글 굵기·기울임·밑줄·취소선, 글자 크기·색·배경색, 소제목, 정렬, 목록, 인용, 구분선, 링크, 그림.
 * 그림은 편집 중에는 브라우저 안의 임시 주소(blob:)로 보여주고,
 * 올릴 때 collectImages() 로 문서 순서대로 모아 실제 파일로 올린 뒤 주소를 바꾼다.
 */
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, Color, BackgroundColor, FontSize } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Image from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extensions';

export type ImageSize = 'original' | 'small' | 'medium' | 'full';

/** 그림에 크기(data-size)와 원본 가로·세로를 붙인 확장 */
const SizedImage = Image.extend({
  draggable: true,
  addAttributes() {
    return {
      ...this.parent?.(),
      size: {
        default: 'original',
        parseHTML: (el) => el.getAttribute('data-size') || 'original',
        renderHTML: (a) => ({ 'data-size': a.size }),
      },
      width: { default: null },
      height: { default: null },
    };
  },
}).configure({ inline: false, allowBase64: false });

export const FONT_SIZES = ['12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px', '40px'];

export interface RichEditor {
  editor: Editor;
  /** 문서에 남아 있는 그림들을 순서대로: [{ src(blob:), file }] */
  collectImages(): { src: string; file: File }[];
  /** 그림 주소를 바꾼 HTML (blob: → 실제 경로) */
  htmlWith(map: Map<string, string>): string;
  isEmpty(): boolean;
  clear(): void;
}

export function createEditor(
  mount: HTMLElement,
  toolbar: HTMLElement,
  onChange?: () => void,
  onNotice?: (message: string) => void,
): RichEditor {
  const files = new Map<string, File>(); // blob 주소 → 원본 파일

  const editor = new Editor({
    element: mount,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } },
        code: false,
        codeBlock: false,
      }),
      TextStyle,
      Color,
      BackgroundColor,
      FontSize,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      SizedImage,
      Placeholder.configure({ placeholder: '여기에 본문을 쓰세요' }),
    ],
    editorProps: {
      attributes: { class: 'prose rich editor-surface', 'aria-label': '본문', role: 'textbox', 'aria-multiline': 'true' },
      // 다른 곳(블로그 등)에서 복사한 글의 그림은 그 사이트 주소라 여기서 쓸 수 없다 → 빼고 안내
      transformPastedHTML: (html) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const imgs = [...doc.querySelectorAll('img')].filter((i) => !i.getAttribute('src')?.startsWith('blob:'));
        imgs.forEach((i) => i.remove());
        if (imgs.length) onNotice?.(`붙여 넣은 글의 그림 ${imgs.length}개는 뺐어요. 그림 파일을 저장한 뒤 "그림 +" 버튼으로 넣어 주세요.`);
        return doc.body.innerHTML;
      },
      // 그림 파일을 끌어다 놓거나 붙여 넣으면 그 자리에 넣는다
      handleDrop: (_view, event) => {
        const list = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'));
        if (!list.length) return false;
        event.preventDefault();
        list.forEach((f) => void insertImage(f));
        return true;
      },
      handlePaste: (_view, event) => {
        const list = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
        if (!list.length) return false;
        list.forEach((f) => void insertImage(f));
        return true;
      },
    },
    onUpdate: () => onChange?.(),
    onSelectionUpdate: () => sync(),
    onTransaction: () => sync(),
  });

  async function insertImage(file: File) {
    const src = URL.createObjectURL(file);
    files.set(src, file);
    let width: number | null = null;
    let height: number | null = null;
    try {
      const bmp = await createImageBitmap(file);
      width = bmp.width;
      height = bmp.height;
    } catch {}
    editor.chain().focus().insertContent({ type: 'image', attrs: { src, alt: '', size: 'original', width, height } }).run();
  }

  // ── 도구 막대 ──
  const q = <T extends HTMLElement = HTMLElement>(sel: string) => toolbar.querySelector<T>(sel);
  const cmd: Record<string, () => void> = {
    bold: () => editor.chain().focus().toggleBold().run(),
    italic: () => editor.chain().focus().toggleItalic().run(),
    underline: () => editor.chain().focus().toggleUnderline().run(),
    strike: () => editor.chain().focus().toggleStrike().run(),
    bullet: () => editor.chain().focus().toggleBulletList().run(),
    ordered: () => editor.chain().focus().toggleOrderedList().run(),
    quote: () => editor.chain().focus().toggleBlockquote().run(),
    hr: () => editor.chain().focus().setHorizontalRule().run(),
    undo: () => editor.chain().focus().undo().run(),
    redo: () => editor.chain().focus().redo().run(),
    'align-left': () => editor.chain().focus().setTextAlign('left').run(),
    'align-center': () => editor.chain().focus().setTextAlign('center').run(),
    'align-right': () => editor.chain().focus().setTextAlign('right').run(),
    'align-justify': () => editor.chain().focus().setTextAlign('justify').run(),
    'color-clear': () => editor.chain().focus().unsetColor().run(),
    'bg-clear': () => editor.chain().focus().unsetBackgroundColor().run(),
    link: () => {
      const prev = editor.getAttributes('link').href as string | undefined;
      const url = prompt('링크 주소 (비우면 링크 해제)', prev ?? 'https://');
      if (url === null) return;
      if (!url.trim() || url === 'https://') editor.chain().focus().extendMarkRange('link').unsetLink().run();
      else editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
    },
    image: () => q<HTMLInputElement>('[data-image-input]')?.click(),
    'img-original': () => editor.chain().focus().updateAttributes('image', { size: 'original' }).run(),
    'img-small': () => editor.chain().focus().updateAttributes('image', { size: 'small' }).run(),
    'img-medium': () => editor.chain().focus().updateAttributes('image', { size: 'medium' }).run(),
    'img-full': () => editor.chain().focus().updateAttributes('image', { size: 'full' }).run(),
  };
  toolbar.querySelectorAll<HTMLButtonElement>('[data-cmd]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.preventDefault();
      cmd[b.dataset.cmd!]?.();
    }),
  );

  const block = q<HTMLSelectElement>('[data-block]');
  block?.addEventListener('change', () => {
    const v = block.value;
    if (v === 'p') editor.chain().focus().setParagraph().run();
    else editor.chain().focus().toggleHeading({ level: Number(v) as 2 | 3 }).run();
  });
  const size = q<HTMLSelectElement>('[data-size]');
  size?.addEventListener('change', () => {
    if (!size.value) editor.chain().focus().unsetFontSize().run();
    else editor.chain().focus().setFontSize(size.value).run();
  });
  const color = q<HTMLInputElement>('[data-color]');
  color?.addEventListener('input', () => editor.chain().focus().setColor(color.value).run());
  const bg = q<HTMLInputElement>('[data-bg]');
  bg?.addEventListener('input', () => editor.chain().focus().setBackgroundColor(bg.value).run());
  const imageInput = q<HTMLInputElement>('[data-image-input]');
  imageInput?.addEventListener('change', async () => {
    for (const f of imageInput.files ?? []) await insertImage(f);
    imageInput.value = '';
  });

  /** 지금 커서 위치의 서식을 버튼에 표시 */
  function sync() {
    const on = (name: string, active: boolean) => q(`[data-cmd="${name}"]`)?.setAttribute('aria-pressed', String(active));
    on('bold', editor.isActive('bold'));
    on('italic', editor.isActive('italic'));
    on('underline', editor.isActive('underline'));
    on('strike', editor.isActive('strike'));
    on('bullet', editor.isActive('bulletList'));
    on('ordered', editor.isActive('orderedList'));
    on('quote', editor.isActive('blockquote'));
    on('link', editor.isActive('link'));
    (['left', 'center', 'right', 'justify'] as const).forEach((a) => on(`align-${a}`, editor.isActive({ textAlign: a })));
    if (block) block.value = editor.isActive('heading', { level: 2 }) ? '2' : editor.isActive('heading', { level: 3 }) ? '3' : 'p';
    if (size) size.value = (editor.getAttributes('textStyle').fontSize as string) || '';
    const img = editor.isActive('image');
    const imgTools = q('[data-image-tools]');
    if (imgTools) imgTools.hidden = !img;
    if (img) (['original', 'small', 'medium', 'full'] as const).forEach((s) => on(`img-${s}`, editor.getAttributes('image').size === s));
  }

  function collectImages() {
    const out: { src: string; file: File }[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'image') {
        const f = files.get(node.attrs.src);
        if (f && !out.some((o) => o.src === node.attrs.src)) out.push({ src: node.attrs.src, file: f });
      }
    });
    return out;
  }

  function htmlWith(map: Map<string, string>) {
    let html = editor.getHTML();
    for (const [from, to] of map) html = html.split(from).join(to);
    return html;
  }

  return {
    editor,
    collectImages,
    htmlWith,
    isEmpty: () => editor.isEmpty,
    clear: () => {
      editor.commands.clearContent();
      files.forEach((_, src) => URL.revokeObjectURL(src));
      files.clear();
    },
  };
}
