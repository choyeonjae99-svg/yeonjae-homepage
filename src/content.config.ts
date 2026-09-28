import { defineCollection } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';

/** 소개: 프로필 (src/content/about/profile.md) */
const profile = defineCollection({
  loader: glob({ pattern: 'profile.md', base: './src/content/about' }),
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      nameEn: z.string(),
      headline: z.string(),
      photo: image(),
      photoAlt: z.string(),
      email: z.email(),
      interests: z.array(z.string()).default([]),
    }),
});

/** 소개: 논문 목록 (src/content/about/papers.json) — 학위논문 + 학술지 논문 */
const papers = defineCollection({
  loader: file('src/content/about/papers.json'),
  schema: z.object({
    type: z.enum(['thesis', 'journal', 'conference']),
    title: z.string(),
    subtitle: z.string().optional(),
    titleEn: z.string().optional(),
    authors: z.array(z.string()),
    venue: z.string(),
    volume: z.string().optional(),
    year: z.number(),
    month: z.number().optional(),
    summary: z.string(),
    keywords: z.array(z.string()).default([]),
    note: z.string().optional(),
    links: z.array(z.object({ label: z.string(), href: z.url() })).default([]),
  }),
});

/**
 * 포트폴리오: src/content/portfolio/{research,design}/[slug].md
 * 이미지는 같은 이름의 폴더에 둔다 (예: research/[slug]/thumb.png).
 * 이름이 _ 로 시작하는 파일(_template.md)은 사이트에 나오지 않는다.
 */
const portfolio = defineCollection({
  loader: glob({
    pattern: ['research/[!_]*.md', 'design/[!_]*.md'],
    base: './src/content/portfolio',
    generateId: ({ entry }) => entry.split('/').pop()!.replace(/\.md$/, ''),
  }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      subtitle: z.string().optional(),
      category: z.enum(['research', 'design']),
      date: z.coerce.date(), // 정렬 기준 (최신이 앞)
      period: z.string(), // 카드에 보이는 날짜·기간
      thumbnail: image().optional(), // 없으면 픽셀 무늬로 대신 표시
      thumbnailAlt: z.string().default(''),
      summary: z.string(),
      tags: z.array(z.string()).default([]),
      role: z.string().optional(),
      venue: z.string().optional(),
      tools: z.array(z.string()).default([]),
      highlights: z.array(z.object({ value: z.string(), label: z.string() })).default([]),
      links: z.array(z.object({ label: z.string(), href: z.url() })).default([]),
      images: z.array(image()).default([]),
      imagesCaption: z.string().optional(),
      draft: z.boolean().default(false), // true 면 사이트에 안 나온다
    }),
});

export const collections = { profile, papers, portfolio };
