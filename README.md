# yeonjae-homepage

조연재 개인 홈페이지. Astro로 만든 정적 사이트.
작업 기준과 디자인 규칙은 [`CLAUDE.md`](./CLAUDE.md), 메인 화면 시안은 [`docs/synapse-prototype.html`](./docs/synapse-prototype.html).

## 로컬 실행

Node.js 22.12 이상이 필요하다.

```sh
npm install      # 처음 한 번
npm run dev      # 개발 서버 → http://localhost:4321
npm run build    # 배포용 빌드 → dist/
npm run preview  # 빌드 결과 미리보기
npm run check    # 타입·템플릿 검사
```

## 폴더 구조

```
src/
  styles/tokens.css   디자인 토큰 (색·폰트·크기·간격)
  styles/global.css   리셋, 도트 격자 배경, 공통 유틸리티
  components/         공통 컴포넌트
  pages/              페이지 (파일 경로 = 주소)
public/
  audio/              배경음악 MP3
  images/             썸네일, 상세 이미지
docs/                 디자인 시안
```
