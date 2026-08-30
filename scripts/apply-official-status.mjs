import fs from 'node:fs/promises';
import path from 'node:path';

const DATA = path.join(process.cwd(), 'data');
const listingsPath = path.join(DATA, 'listings.json');
const historyPath = path.join(DATA, 'history.json');
const statusPath = path.join(DATA, 'official-status.json');
const read = async (p, d) => { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return d; } };
const write = async (p, x) => fs.writeFile(p, JSON.stringify(x, null, 2) + '\n');
const payload = await read(listingsPath, { meta: {}, listings: [] });
const history = await read(historyPath, {});
const official = await read(statusPath, { projects: [] });
const today = new Date().toISOString().slice(0, 10);
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const dedupeOfficialRemovalHistory = (listingId, reason) => {
  const rows = history[listingId] || [];
  const repeatedNote = `REMOVED: ${reason}`;
  let kept = false;
  history[listingId] = rows.filter(row => {
    if (row?.note !== repeatedNote) return true;
    if (kept) return false;
    kept = true;
    return true;
  });
};

const actions = [];
for (const p of official.projects || []) {
  const matches = payload.listings.filter(x =>
    (p.buildingName && norm(x.buildingName) === norm(p.buildingName)) ||
    (p.address && norm(String(x.address || '').split(',')[0]) === norm(String(p.address).split(',')[0]))
  );

  if (p.effectiveStatus === 'fully_leased') {
    for (const x of matches) {
      // Some upstream verification passes may record the same removal reason on every run.
      // Keep one provenance row for the explicit official negative instead of growing history forever.
      dedupeOfficialRemovalHistory(x.id, p.reason);
      if (x.availabilityStatus === 'removed' && x.officialStatusReason === p.reason) continue;
      const prior = x.availabilityStatus;
      x.availabilityStatus = 'removed';
      x.status = 'removed';
      x.removedAt = today;
      x.lastChecked = today;
      x.verifiedAt = p.checkedAt || official.refreshedAt;
      x.verificationLevel = 'verified';
      x.verificationMethod = `Official freshness override: ${p.reason}`;
      x.officialStatus = p.effectiveStatus;
      x.officialStatusAuthority = p.authority;
      x.officialStatusReason = p.reason;
      x.officialAnnouncementUrl = p.latestManualAnnouncement?.evidenceUrl || null;
      history[x.id] ||= [];
      if (!history[x.id].some(h => h.date === today && /OFFICIAL STATUS/.test(h.note || ''))) {
        history[x.id].push({ date: today, rent: x.rent, note: `OFFICIAL STATUS: ${p.buildingName} marked fully leased; removed from active inventory. ${p.reason}` });
      }
      actions.push({ listingId: x.id, buildingName: p.buildingName, from: prior, to: 'removed' });
    }
  } else if (p.effectiveStatus === 'leasing') {
    // Positive building-level official status is supporting evidence only. Never revive a removed unit.
    for (const x of matches) {
      x.officialStatus = 'leasing';
      x.officialStatusAuthority = p.authority;
      x.officialStatusReason = p.reason;
    }
  }
}

payload.meta ||= {};
payload.meta.lastOfficialStatusRefresh = official.refreshedAt || new Date().toISOString();
payload.meta.officialStatusPolicy = official.policy || 'Newer official negative announcements override marketplace evidence.';
await write(listingsPath, payload);
await write(historyPath, history);
await write(path.join(DATA, 'official-status-actions.json'), { refreshedAt: new Date().toISOString(), actions });
console.log(`Official status apply: ${actions.length} listing status changes.`);
