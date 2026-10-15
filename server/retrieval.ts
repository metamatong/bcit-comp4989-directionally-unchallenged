import { catalogue } from './data';
const searchCache = new Map<
  string,
  { expires: number; records: ReturnType<typeof findCampusRecords> }
>();
export const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function findCampusRecords(query: string) {
  const tokens = normalize(query).split(' ').filter(Boolean);
  if (!tokens.length) return [];
  return catalogue
    .map((record) => {
      const haystack = normalize(`${record.title} ${record.text}`);
      const score = tokens.reduce(
        (sum, token) => sum + (` ${haystack} `.includes(` ${token} `) ? 1 : 0),
        0,
      );
      return { record, score };
    })
    .filter((item) => item.score === tokens.length)
    .slice(0, 8)
    .map(({ record }) => {
      const { text, ...metadata } = record;
      const matchAt = text.toLowerCase().indexOf(query.toLowerCase());
      return {
        ...metadata,
        excerpt: text.slice(Math.max(0, matchAt - 70), Math.max(0, matchAt - 70) + 350),
        notice: 'Extracted source text; room labels unreviewed. Campus routing unavailable.',
      };
    });
}

export function searchCampus(query: string) {
  const key = normalize(query).slice(0, 1500),
    cached = searchCache.get(key);
  if (cached && cached.expires > Date.now()) return structuredClone(cached.records);
  const records = findCampusRecords(key);
  if (searchCache.size >= 100) searchCache.delete(searchCache.keys().next().value!);
  searchCache.set(key, { expires: Date.now() + 300000, records });
  return structuredClone(records);
}
