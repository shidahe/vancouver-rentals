const NEGATIVE_PET_POLICY = /\b(?:no\s+(?:cats?|dogs?|pets?)|pets?\s+(?:are\s+)?not\s+(?:allowed|permitted)|no[- ]pet)\b/i;
const POSITIVE_PET_POLICY = /\b(?:pet friendly|pets? allowed|dogs? (?:are )?ok|cats? (?:are )?ok)\b/i;

export function zumperPetFriendly(home, description = '') {
  const text = String(description);
  if (NEGATIVE_PET_POLICY.test(text)) return false;
  if (home?.petsAllowed === false) return false;

  // Zumper renders a generic "Nearby Pet Friendly" navigation widget on
  // property pages. It is not a policy for the advertised unit.
  const listingText = text.replace(/\bNearby Pet Friendly\b/gi, '');
  if (home?.petsAllowed === true || POSITIVE_PET_POLICY.test(listingText)) return true;
  return null;
}
