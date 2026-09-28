export const SITE = {
  name: '조연재',
  nameEn: 'Cho Yeonjae',
  logo: 'CHOYEONJAE',
  email: 'skyyeonjae@naver.com',
  tagline: '게임 연구 · 사용자 연구 · 시각 디자인',
};

/** 배경음악: YouTube 영상 id (youtu.be/뒤의 값). 바꾸려면 이 값만 고친다 */
export const MUSIC = {
  youtubeId: '05BWsYqMiYE',
  volume: 60, // 0–100
};

export const NAV = [
  { href: '/about', label: '소개' },
  { href: '/portfolio', label: '포트폴리오' },
  { href: '/works', label: '그 외 작업물' },
] as const;
