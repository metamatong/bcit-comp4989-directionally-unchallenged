import { useEffect, useState, type CSSProperties } from 'react';
import shells from '../assets/campus-search.svg';
import type { DeviceReading } from '../location/types';

const models = [
  { id: 'SE12', x: 357, y: 61, bounds: [275, 36, 434, 104], roof: '#93bbdd' },
  { id: 'SW5', x: 347, y: 140, bounds: [321, 120, 373, 167], roof: '#80abce' },
  { id: 'SW1', x: 184, y: 112, bounds: [86, 46, 291, 182], roof: '#a4c6df' },
  { id: 'SW3', x: 292, y: 161, bounds: [259, 75, 352, 207], roof: '#72a4ce' },
];
const canonical = (id: string) => id.replace(/^SW0/, 'SW');
const display = (id: string) => id.replace(/^SW(\d)$/, 'SW0$1');
export const zoomDurationMs = 900;

export function CampusSearchMap({ building, reading, routeBuildings = [] }: {
  building?: string;
  reading?: DeviceReading;
  routeBuildings?: string[];
}) {
  const start = canonical(building ?? '');
  const visible = new Set([start, ...routeBuildings.map(canonical)]);
  const selected = models.filter(model => visible.has(model.id));
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!selected.length) return null;
  const left = Math.min(...selected.map(m => m.bounds[0])) - 16;
  const right = Math.max(...selected.map(m => m.bounds[2])) + 16;
  const top = Math.min(...selected.map(m => m.bounds[1])) - 16;
  const bottom = Math.max(...selected.map(m => m.bounds[3])) + 16;
  const scale = Math.min(520 / (right - left), 240 / (bottom - top));
  const east = reading ? (reading.longitude + 123) * 72600 : 0;
  const north = reading ? (reading.latitude - 49.25) * 111195 : 0;
  const x = 412.0283 + 1.3483373 * (.4 * east - .92 * north);
  const y = -27.88295 + 1.3483373 * (-.65 * east - .22 * north);
  return (
    <figure className="campus-position-map">
      <svg viewBox="0 0 520 240" role="img" aria-label={'Campus buildings: ' + selected.map(m => display(m.id)).join(', ')}>
        <g className="search-model-camera" style={{transform: mounted ? `translate(${260 - scale * (left + right) / 2}px, ${120 - scale * (top + bottom) / 2}px) scale(${scale})` : undefined}}>
          {selected.map(model => (
            <g key={model.id} className="search-building" style={{
              '--roof': model.roof, '--side': '#49749c', '--edge': '#355b79',
            } as CSSProperties}>
              <use href={shells + '#shell-' + model.id} />
              <text x={model.x} y={model.y} textAnchor="middle" fontSize="12" fontWeight="700"
                fill="#173955" stroke="white" strokeWidth="2.5" paintOrder="stroke">{display(model.id)}</text>
            </g>
          ))}
          {reading && x >= 0 && x <= 520 && y >= 0 && y <= 240 && <g>
            <title>GPS at submission, ±{Math.ceil(reading.accuracy)} metres</title>
            <circle r={reading.accuracy} transform={`matrix(.539335 -.876419 -1.24047 -.296634 ${x} ${y})`} fill="#2474c733" stroke="#2474c7" vectorEffect="non-scaling-stroke"/>
            <circle cx={x} cy={y} r="3" fill="#165c9e" stroke="white"/>
          </g>}
        </g>
      </svg>
    </figure>
  );
}
