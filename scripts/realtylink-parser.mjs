export function parseRealtylinkCoordinates(text) {
  const match = String(text || '').match(/\b(4[89]\.\d{3,12})\s+(-12[23]\.\d{3,12})\s+true\b/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

export function isTargetWestsideCoordinate(coordinate) {
  if (!coordinate) return false;
  return coordinate.lat >= 49.225 && coordinate.lat <= 49.286 &&
    coordinate.lng >= -123.215 && coordinate.lng <= -123.135;
}
