import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// FRL_STATE_FILE lets tests and throwaway sessions run against their own file.
const DATA_DIR = process.env.FRL_STATE_FILE
  ? path.dirname(path.resolve(process.env.FRL_STATE_FILE))
  : path.join(__dirname, '..', 'data');
const STATE_FILE = process.env.FRL_STATE_FILE
  ? path.resolve(process.env.FRL_STATE_FILE)
  : path.join(DATA_DIR, 'state.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

/**
 * The event, kept in a JSON file next to the server.
 *
 * Split out of RaceState so that class holds no opinion about where its state lives. That
 * was always a little untrue of it: the paths came from module level constants read out of
 * the environment, which meant two RaceState objects in one process could not have
 * separate storage and a test could not have none at all.
 *
 * It matters more now. The same timing code has to run in an operator's browser against a
 * hosted event, and a class that reaches for `fs` on construction cannot.
 */
export class FileStore {

  read() {
    this.backup();
    if (!fs.existsSync(STATE_FILE)) return null;
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  }

  write(state) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }

  /** Snapshot the file before this process can write over it. */
  backup() {
    try {
      if (!fs.existsSync(STATE_FILE)) return;
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      fs.copyFileSync(STATE_FILE, path.join(BACKUP_DIR, `state-${stamp}.json`));
      const old = fs.readdirSync(BACKUP_DIR)
        .filter((f) => f.startsWith('state-') && f.endsWith('.json'))
        .sort()
        .slice(0, -10);
      for (const f of old) fs.rmSync(path.join(BACKUP_DIR, f), { force: true });
    } catch (err) {
      console.error('[state] backup failed:', err.message);
    }
  }
}
