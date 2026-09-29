/**
 * 서버 전용 환경변수. Vercel 프로젝트 설정 → Environment Variables 에서 넣는다.
 * 값이 없으면 해당 기능만 "준비 중" 으로 동작하고 사이트는 그대로 뜬다.
 */
const read = (...names: string[]) => {
  for (const n of names) {
    const v = process.env[n] ?? (import.meta.env as Record<string, string | undefined>)[n];
    if (v) return v;
  }
  return undefined;
};

export const env = {
  /** 관리자 로그인 비밀번호 */
  adminPassword: () => read('ADMIN_PASSWORD'),
  /** 로그인 쿠키 서명용 임의 문자열 (32자 이상) */
  sessionSecret: () => read('SESSION_SECRET'),
  /** GitHub fine-grained token (이 저장소 Contents: Read and write) */
  githubToken: () => read('GITHUB_TOKEN'),
  /** 테스트용: GitHub API 주소 바꾸기 */
  githubApi: () => read('GITHUB_API_URL') ?? 'https://api.github.com',
  /** Upstash Redis (Vercel Marketplace 연동 시 KV_* 이름으로 자동 등록된다) */
  redisUrl: () => read('KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL'),
  redisToken: () => read('KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN'),
};
