// @ts-check
import { defineConfig } from 'astro/config';

/**
 * 사이트 절대 주소 (공유 미리보기 이미지·canonical 주소에 쓰인다).
 * 1) SITE_URL 환경변수가 있으면 그 값
 * 2) Vercel 에서는 운영 도메인(VERCEL_PROJECT_PRODUCTION_URL)을 자동으로 사용
 *    → 개인 도메인을 연결하면 다음 배포부터 그 도메인으로 바뀐다
 * 3) 둘 다 없으면(로컬) localhost
 */
const site =
  process.env.SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : 'http://localhost:4321');

export default defineConfig({
  site,
});
