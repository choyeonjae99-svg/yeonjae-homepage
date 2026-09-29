import { REPO } from './site';

/** 주인이 GitHub 에서 콘텐츠를 바로 추가할 때 쓰는 링크들 */
const base = `https://github.com/${REPO.owner}/${REPO.name}`;

/** 템플릿이 채워진 새 파일 화면 */
export const githubNewFile = (dir: string, filename: string, template: string) =>
  `${base}/new/${REPO.branch}/${dir}?filename=${encodeURIComponent(filename)}&value=${encodeURIComponent(template)}`;

/** 이미지 올리기 화면 */
export const githubUpload = (dir: string) => `${base}/upload/${REPO.branch}/${dir}`;
