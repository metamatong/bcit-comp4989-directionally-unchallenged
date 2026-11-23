/** Display-only camera math and relationship colors; never used for source or route coordinates. */
export const relationshipColors: Record<
  string,
  { label: string; color: string }
> = {
  corridor: { label: "Corridor", color: "#67dfef" },
  stairs: { label: "Stairs", color: "#ffb454" },
  elevator: { label: "Elevator", color: "#b99aff" },
  "building-link": { label: "Building link", color: "#ff80ae" },
  outdoor: { label: "Outdoor passage", color: "#a5dd70" },
};
export function wrapAngle(degrees: number) {
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}
export function rotatePoint(
  point: { x: number; y: number; z: number },
  orbit: number,
  tilt: number,
  roll: number,
) {
  const a = (orbit * Math.PI) / 180,
    t = (tilt * Math.PI) / 180,
    r = (roll * Math.PI) / 180;
  const x = point.x * Math.cos(a) - point.y * Math.sin(a);
  const y = point.x * Math.sin(a) + point.y * Math.cos(a);
  const vertical = y * Math.cos(t) - point.z * Math.sin(t);
  return {
    x: x * Math.cos(r) - vertical * Math.sin(r),
    y: x * Math.sin(r) + vertical * Math.cos(r),
    depth: y * Math.sin(t) + point.z * Math.cos(t),
  };
}

/** Keep the world point under the pointer fixed while changing orthographic scale. */
export function zoomPan(
  pan: { x: number; y: number },
  anchor: { x: number; y: number },
  oldZoom: number,
  newZoom: number,
) {
  const ratio = newZoom / oldZoom;
  return {
    x: anchor.x - (anchor.x - pan.x) * ratio,
    y: anchor.y - (anchor.y - pan.y) * ratio,
  };
}
export function matchesFloorPair(id: string, first: string, second: string) {
  return first === "all" || id === first || (second !== "" && id === second);
}
