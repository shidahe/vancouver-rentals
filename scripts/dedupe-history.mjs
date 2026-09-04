import fs from 'node:fs/promises';
import path from 'node:path';
import { dedupeHistoryEvents } from './history-policy.mjs';

const historyPath = path.join(process.cwd(), 'data', 'history.json');
const history = JSON.parse(await fs.readFile(historyPath, 'utf8'));
const result = dedupeHistoryEvents(history);

if (result.removed > 0) {
  await fs.writeFile(historyPath, `${JSON.stringify(result.history, null, 2)}\n`);
}
console.log(`History normalization: removed ${result.removed} duplicate event${result.removed === 1 ? '' : 's'}.`);
