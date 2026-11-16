/** Mocked browser positions for lifecycle tests. */
export function position(timestamp = Date.now()): GeolocationPosition {
  return {
    timestamp,
    coords: { latitude: 49.25, longitude: -123.001, accuracy: 5 },
  } as GeolocationPosition;
}
