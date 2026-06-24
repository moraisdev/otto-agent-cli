const CORRECTION_PATTERNS: RegExp[] = [
  /\bn[ãa]o (é|e) (assim|isso)\b/i,
  /\bn[ãa]o era (assim|isso)\b/i,
  /\bt[áa] errad/i,
  /\best[áa] errad/i,
  /\bfaz assim\b/i,
  /\bfa[çc]a assim\b/i,
  /\bcorrig/i,
  /\bna verdade\b/i,
];

export function looksLikeCorrection(text: string): boolean {
  if (!text) return false;
  return CORRECTION_PATTERNS.some((pattern) => pattern.test(text));
}
