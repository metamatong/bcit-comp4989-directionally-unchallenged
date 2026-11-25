import campusMap from '../assets/campus-search.svg';
import type { DeviceReading } from '../location/types';

// Ground-plane registration used by the four-building axonometric artwork.
const scale = 1.3483373186000787;
const origin = { x: 412.02829804962175, y: -27.882951850066576 };

// Roof anchors and label centres in the campus artwork's 520 × 240 viewBox.
const searchLabels = [
  { name: 'SW01', x: 55, y: 96, roofX: 120, roofY: 110 },
  { name: 'SE12', x: 376, y: 19, roofX: 358, roofY: 59 },
  { name: 'SW03', x: 280, y: 220, roofX: 295, roofY: 183 },
  { name: 'SW05', x: 428, y: 149, roofX: 350, roofY: 140 },
];

export function CampusPositionMap({
  reading,
  searching = false,
}: {
  reading?: DeviceReading | null;
  searching?: boolean;
}) {
  const east = reading ? (reading.longitude + 123) * 72600 : 0;
  const north = reading ? (reading.latitude - 49.25) * 111195 : 0;
  const x = origin.x + scale * (0.4 * east - 0.92 * north);
  const y = origin.y + scale * (-0.65 * east - 0.22 * north);
  const onMap = !!reading && x >= 0 && x <= 520 && y >= 0 && y <= 240;
  const caption = !reading
    ? searching
      ? 'Campus map'
      : 'Campus GPS unavailable'
    : !onMap
      ? 'GPS outside this map'
      : (searching ? 'GPS at submission' : 'Campus GPS') +
        ' · ±' +
        Math.ceil(reading.accuracy) +
        ' m';
  return (
    <figure className="campus-position-map">
      <svg
        viewBox="0 0 520 240"
        role="img"
        aria-label={
          searching
            ? caption + '. Buildings: ' + searchLabels.map((label) => label.name).join(', ')
            : caption
        }
      >
        <image href={searching ? campusMap : campusMap + '#guidance'} width="520" height="240" />
        {searching &&
          searchLabels.map(({ name, x, y, roofX, roofY }) => (
            <g key={name} aria-hidden="true">
              <line x1={x} y1={y} x2={roofX} y2={roofY} stroke="#355f50" strokeWidth="1.6" />
              <rect
                x={x - 29}
                y={y - 12}
                width="58"
                height="24"
                rx="5"
                fill="#fff"
                stroke="#9eb8aa"
              />
              <text
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#193f34"
                fontSize="17"
                fontWeight="650"
                fontFamily="system-ui, sans-serif"
              >
                {name}
              </text>
            </g>
          ))}
        {onMap && reading && (
          <g className="campus-gps-position">
            <circle
              r={reading.accuracy}
              transform={`matrix(${0.4 * scale} ${-0.65 * scale} ${-0.92 * scale} ${-0.22 * scale} ${x} ${y})`}
              fill="#2274bd33"
              stroke="#18528b"
              vectorEffect="non-scaling-stroke"
              strokeWidth="1"
            />
            <circle cx={x} cy={y} r="5" stroke="white" strokeWidth="2" fill="#165c9e" />
          </g>
        )}
      </svg>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
