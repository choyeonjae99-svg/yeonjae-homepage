import type { ImageMetadata } from 'astro';

/**
 * 반응형 이미지 너비 목록: 원본보다 큰 사이즈는 만들지 않는다 (늘려서 흐려지는 것 방지).
 * 원본 너비 자체를 항상 포함한다.
 */
export const widthsFor = (img: ImageMetadata, candidates: number[]) => [
  ...new Set([...candidates.filter((w) => w < img.width), img.width]),
];

/** 그림 화질: 선이 많은 드로잉도 뭉개지지 않게 높게 */
export const IMAGE_QUALITY = 90;
