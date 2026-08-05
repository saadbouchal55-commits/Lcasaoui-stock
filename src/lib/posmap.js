// Loads POS mapping side-config (ignore + drinks lists, special frites rule).
// Dish-name -> Dish mapping itself lives in the DB (PosMapping table) so the
// Direction can maintain spelling variants without editing files.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = join(__dirname, '..', '..', 'data', 'pos_mapping.json');

let cache = null;

export function loadPosConfig() {
  if (!cache) cache = JSON.parse(readFileSync(FILE, 'utf-8'));
  return cache;
}

export default loadPosConfig;
