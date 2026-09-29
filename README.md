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

## 배포 (Vercel)

`main` 브랜치에 커밋이 올라가면 Vercel 이 자동으로 빌드·배포한다.
프레임워크는 Astro 로 자동 인식되고, 빌드 명령 `npm run build`, 출력 폴더 `dist` 이다.

- 공유 미리보기(Open Graph) 주소는 Vercel 운영 도메인을 자동으로 쓴다.
  개인 도메인을 Vercel 에 연결하면 다음 배포부터 그 도메인이 들어간다.
- 주소를 직접 정하려면 Vercel 환경변수 `SITE_URL` (예: `https://yeonjae.com`).
