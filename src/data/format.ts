const pad = (n: number) => String(n).padStart(2, '0');

/** 2026-03-05 → 2026.03.05 (빌드 시간대와 상관없이 UTC 기준) */
export const formatDate = (d: Date) => `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}`;
