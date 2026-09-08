import fs from 'node:fs/promises';
import path from 'node:path';
import { dedupeHistoryEvents, pruneExcludedScopeChurn } from './history-policy.mjs';

const historyPath = path.join(process.cwd(), 'data', 'history.json');
const history = JSON.parse(await fs.readFile(historyPath, 'utf8'));
const listings = JSON.parse(await fs.readFile(path.join(process.cwd(), 'data', 'listings.json'), 'utf8')).listings || [];
const excludedIds = listings.filter(x => x.availabilityStatus === 'excluded').map(x => x.id);
const churn = pruneExcludedScopeChurn(history, excludedIds);
const result = dedupeHistoryEvents(churn.history);

if (result.removed > 0 || churn.removed > 0) {
  await fs.writeFile(historyPath, `${JSON.stringify(result.history, null, 2)}\n`);
}
console.log(`History normalization: removed ${result.removed} duplicate event${result.removed === 1 ? '' : 's'} and ${churn.removed} excluded-scope churn event${churn.removed === 1 ? '' : 's'}.`);
