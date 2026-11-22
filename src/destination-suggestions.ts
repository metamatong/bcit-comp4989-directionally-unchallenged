import type { DestinationSuggestion } from './types';

const BUILDING_ALIASES: Record<string, string> = {
  SW1: 'SW01',
  SW01: 'SW01',
  SW3: 'SW03',
  SW03: 'SW03',
  SW5: 'SW05',
  SW05: 'SW05',
  SE12: 'SE12',
};

const KIND_LABELS: Record<string, string> = {
  av: 'AV',
  'food-service': 'Food service',
  'instructional-support': 'Instructional support',
};

export function formatPlaceKind(kind: string): string {
  if (KIND_LABELS[kind]) return KIND_LABELS[kind];
  if (!kind) return '';
  const spaced = kind.replace(/-/g, ' ');
  return spaced[0].toUpperCase() + spaced.slice(1);
}

function normalizeQuery(raw: string): {
  full: string;
  building?: string;
  rest: string;
} {
  const cleaned = raw
    .normalize('NFKC')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  if (!cleaned) return { full: '', rest: '' };

  // Recognize full or compact building prefixes like "SW3 2605", "SW03-2605", "SW032605", or "SE12".
  const prefixMatch = /^(SE12|SW0?[135])(?:[\s-]+(.*)|([A-Z0-9].*))?$/.exec(cleaned);
  if (prefixMatch) {
    const building = BUILDING_ALIASES[prefixMatch[1]] ?? prefixMatch[1];
    const rest = (prefixMatch[2] ?? prefixMatch[3] ?? '').trim();
    return { full: rest ? `${building} ${rest}` : building, building, rest };
  }
  return { full: cleaned, rest: cleaned };
}

/**
 * Filter and rank pilot destination suggestions without truncating or merging exact identifiers.
 * Exact label matches always rank above prefix matches, which rank above substring and kind matches.
 */
export function filterDestinationSuggestions(
  destinations: readonly DestinationSuggestion[],
  query: string,
  limit = 8,
): DestinationSuggestion[] {
  const { full, building, rest } = normalizeQuery(query);
  if (!full) return [];

  const scored: { item: DestinationSuggestion; rank: number }[] = [];
  for (const item of destinations) {
    const itemBuilding = item.building.toUpperCase();
    const itemLabel = item.label.toUpperCase();
    const itemValue = item.value.toUpperCase();
    const itemKind = item.kind.toUpperCase().replace(/-/g, ' ');

    if (building && itemBuilding !== building) continue;

    let rank = -1;
    if (itemValue === full || (!building && itemLabel === rest)) {
      rank = 0; // Exact full or exact room-number match
    } else if (building && !rest) {
      rank = 1; // Building selected, show rooms in that building
    } else if (itemLabel.startsWith(rest)) {
      rank = 2; // Exact room prefix match
    } else if (itemValue.startsWith(full)) {
      rank = 3; // Value prefix match (e.g. "SW" -> "SW03 ...")
    } else if (rest.length >= 2 && itemLabel.includes(rest)) {
      rank = 4; // Substring within room identifier
    } else if (rest.length >= 3 && itemKind.includes(rest)) {
      rank = 5; // Room category match (e.g. "lab", "washroom", "classroom")
    }

    if (rank >= 0) scored.push({ item, rank });
  }

  scored.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.item.building !== b.item.building) return a.item.building.localeCompare(b.item.building);
    return a.item.label.localeCompare(b.item.label, undefined, { numeric: true });
  });

  return scored.slice(0, limit).map((entry) => entry.item);
}
