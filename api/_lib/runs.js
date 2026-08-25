/* Run records.
 *
 * A run that changes nothing looks exactly like a run that never happened, and
 * a run that never happened looks exactly like a quiet night. The only way to
 * tell the three apart afterwards is to write down what each run did at the
 * time ... including the runs that found nothing, and including the runs that
 * failed.
 *
 * One file per cron, newest first, trimmed to a fixed depth. Static JSON, so
 * the record is queryable by anyone with the URL and needs no function to read.
 */
import { readFile, writeFile } from './repo.js';

export async function loadRuns(path) {
  const f = await readFile(path).catch(() => ({ sha: null, text: null }));
  let runs = [];
  if (f.text) {
    try { runs = JSON.parse(f.text).runs || []; } catch (e) { /* start the record again */ }
  }
  return { runs, sha: f.sha || undefined };
}

export async function saveRuns(path, { runs, sha }, entry, { keep = 90, note, message }) {
  const kept = [entry, ...runs].slice(0, keep);
  await writeFile(path, JSON.stringify({ _note: note, keep, runs: kept }, null, 1) + '\n', message, sha);
  return kept;
}

/* Hours since the previous run finished. A gap much larger than the schedule
   is a run that did not happen, which is the failure nobody sees. */
export function hoursSince(runs, now = Date.now()) {
  const last = runs.find((r) => r && r.at);
  if (!last) return null;
  return (now - new Date(last.at).getTime()) / 3600000;
}
