const AUTO_VERIFICATION = /(?:Automated live browser check|AUTO-PUBLISHED)/i;

export function isAutoManagedListing(listing) {
  if (!listing || listing.availabilityStatus !== 'active') return false;
  if (listing.mlsInventoryManaged === true) return false;
  return AUTO_VERIFICATION.test(String(listing.verificationMethod || ''));
}
