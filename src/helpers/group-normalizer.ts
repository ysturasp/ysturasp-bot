export function normalizeGroupKey(name: string): string {
  if (!name) return '';

  const similarLettersMap: Record<string, string> = {
    a: 'а',
    b: 'в',
    e: 'е',
    k: 'к',
    m: 'м',
    h: 'н',
    o: 'о',
    p: 'р',
    c: 'с',
    t: 'т',
    x: 'х',
    y: 'у',
  };

  const cleaned = name
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[-–—_]/g, '');

  let result = '';
  for (const ch of cleaned) {
    result += similarLettersMap[ch] || ch;
  }

  return result;
}

export function findCanonicalGroupName(
  input: string,
  groups: string[] | undefined | null,
): string | null {
  if (!input || !groups || !groups.length) return null;

  const targetKey = normalizeGroupKey(input);
  if (!targetKey) return null;

  for (const g of groups) {
    const str = String(g).trim();
    if (!str) continue;
    if (normalizeGroupKey(str) === targetKey) {
      return str;
    }
  }

  return null;
}

export function normalizeAudienceName(name: string): string {
  if (!name) return '';

  return name
    .toLowerCase()
    .trim()
    .replace(/[-–—_]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([а-яёa-z]+)\s+(\d+[а-яёa-z]*)/gi, '$1$2')
    .replace(/\s+/g, '')
    .trim();
}
