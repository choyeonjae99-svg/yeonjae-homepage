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

export const collections = { profile, papers };
