export const SITE = {
  name: '조연재',
  nameEn: 'Cho Yeonjae',
  logo: 'CHOYEONJAE',
  email: 'skyyeonjae@naver.com',
  tagline: '게임 연구 · 사용자 연구 · 시각 디자인',
};

import beat from './music.json';

/**
 * 배경음악: YouTube 영상 id (youtu.be/뒤의 값). 바꾸려면 이 값만 고친다.
 * 박자(bpm·첫 박 위치)는 music.json — 관리자 페이지(/admin)의 "박자 맞추기"에서 탭으로 정해 저장한다.
 */
export const MUSIC = {
  youtubeId: '05BWsYqMiYE',
  volume: 60, // 0–100
  bpm: beat.bpm, // 분당 박 수
  offset: beat.offset, // 첫 박이 나오는 시각 (초)
  beatsPerBar: beat.beatsPerBar, // 한 마디 박 수 (강박 주기)
};

export const NAV = [
  { href: '/about', label: '소개' },
  { href: '/portfolio', label: '포트폴리오' },
  { href: '/works', label: '그 외 작업물' },
  { href: '/guestbook', label: '방명록' },
] as const;

/** 콘텐츠를 GitHub 에서 바로 추가할 때 쓰는 저장소 정보 (포트폴리오 추가 버튼) */
export const REPO = {
  owner: 'choyeonjae99-svg',
  name: 'yeonjae-homepage',
  branch: 'main', // 사이트가 배포되는 브랜치
};
