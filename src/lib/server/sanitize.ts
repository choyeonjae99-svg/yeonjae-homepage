import sanitizeHtml from 'sanitize-html';

/**
 * 편집기 본문 HTML 정리: 허용한 태그·속성·스타일만 남긴다.
 * (다른 사이트에서 붙여 넣은 글에 섞인 스크립트·이상한 스타일이 사이트를 깨뜨리지 않게)
 * 그림은 이 글의 업로드 폴더(/uploads/<kind>/<slug>/...) 것만 남긴다.
 */
const COLOR = [/^[a-z]{3,20}$/i, /^#[0-9a-f]{3,8}$/i, /^rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+\s*)?\)$/i];

export function sanitizeBody(html: string, imagePrefix: string, allowedImages: Set<string>) {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'br', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'span', 'mark', 'ul', 'ol', 'li', 'blockquote', 'hr', 'a', 'img'],
    allowedAttributes: {
      '*': ['style'],
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height', 'data-size'],
    },
    allowedStyles: {
      '*': {
        color: COLOR,
        'background-color': COLOR,
        'font-size': [/^(?:[89]|[1-6]\d|7[0-2])(?:\.\d+)?px$/],
        'text-align': [/^(left|right|center|justify)$/],
      },
      img: { 'max-width': [/^\d{1,5}px$/] },
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesAppliedToAttributes: ['href'],
    allowProtocolRelative: false,
    transformTags: {
      a: (tag, attribs) => ({ tagName: tag, attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer' } }),
      img: (tag, attribs) => ({
        tagName: tag,
        attribs: {
          ...attribs,
          'data-size': ['original', 'small', 'medium', 'full'].includes(attribs['data-size']) ? attribs['data-size'] : 'original',
          width: /^\d{1,5}$/.test(attribs.width ?? '') ? attribs.width : '',
          height: /^\d{1,5}$/.test(attribs.height ?? '') ? attribs.height : '',
          // 원본 가로보다 크게 늘어나지 않도록 최대 폭을 박아 둔다
          style: /^\d{1,5}$/.test(attribs.width ?? '') ? `max-width:${attribs.width}px` : '',
        },
      }),
    },
    // 이 글에 함께 올린 그림이 아니면 지운다
    exclusiveFilter: (frame) =>
      frame.tag === 'img' && !(frame.attribs.src?.startsWith(imagePrefix) && allowedImages.has(frame.attribs.src.slice(imagePrefix.length))),
  })
    .replace(/\s(width|height)=""/g, '')
    .replace(/\n/g, ' '); // 마크다운 안에서 한 덩어리 HTML 로 유지되도록 한 줄로
}
