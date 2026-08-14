/**
 * Which conversations a scheduled job lives in.
 *
 * **Only these conversations have anything to notify about.** A subagent
 * spawned on a cron has no session watching it, so the user-facing push *is*
 * its delivery surface — `runtime/subagents.py` says so where it decides the
 * child's mode: "a scheduled spawn keeps the default on — the push is its only
 * delivery surface." A conversation you are typing in reports itself by being
 * on screen, and offering to turn notifications on or off for one is offering a
 * setting with nothing to act on.
 *
 * The binding is `payload.conversation_id` on a `subagent.spawn` job. A
 * recurring job does not start with one: `_remember_conversation` writes it
 * back after the first run so the job accumulates a single transcript instead
 * of scattering itself across a new conversation per firing. A job without one
 * makes a fresh conversation every time, and no existing conversation is its
 * home.
 *
 * `scheduled_jobs` is declared `hidden`, which keeps it out of `/config`'s
 * catalogue — it belongs to the timekeeper service, not to a settings form —
 * but that flag filters the catalogue only. Reading the value by name is an
 * ordinary `config.read`.
 */

/** The kernel setting the timekeeper owns. Read it with
 *  `config.read {key: SCHEDULED_JOBS}`; the provider does that, so this module
 *  stays a pure function of the answer and needs no DOM to test. */
export const SCHEDULED_JOBS = "scheduled_jobs";

/** The one channel that spawns into a named conversation. A job on any other
 *  channel may carry a `conversation_id` meaning something else entirely, so
 *  the channel is checked rather than assumed. */
const SUBAGENT_SPAWN = "subagent.spawn";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Every conversation a scheduled subagent spawns into.
 *
 * Pure, and separate from the read below, because the shape is four levels deep
 * and hand-parsed: a job map, a job, its payload, and an id that may be absent
 * on a job that has never run.
 *
 * **A disabled job still counts.** It names the conversation, and whether it
 * happens to be paused right now is a different question from whether this
 * conversation is a job's home — re-enabling it should not also require
 * remembering to turn notifications back on.
 */
export function scheduledConversations(jobs: unknown): Set<number> {
  const ids = new Set<number>();
  if (!isRecord(jobs)) return ids;

  for (const job of Object.values(jobs)) {
    if (!isRecord(job) || job.channel !== SUBAGENT_SPAWN) continue;
    const payload = job.payload;
    if (!isRecord(payload)) continue;
    const id = payload.conversation_id;
    if (typeof id === "number" && Number.isInteger(id)) ids.add(id);
  }
  return ids;
}
