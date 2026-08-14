import { describe, expect, it } from "vitest";

import { scheduledConversations } from "@/lib/schedules";

/** One job, shaped the way `scheduled_jobs` actually holds them. */
const job = (payload: unknown, overrides: Record<string, unknown> = {}) => ({
  enabled: true,
  channel: "subagent.spawn",
  cron: "0 12 * * *",
  run_at: null,
  one_time: false,
  payload,
  ...overrides,
});

describe("which conversations a scheduled job owns", () => {
  it("reads the id out of a spawn job's payload", () => {
    const ids = scheduledConversations({
      daily_dc_tips: job({ title: "Daily DC tips", prompt: "…", conversation_id: 100103 }),
    });

    expect([...ids]).toEqual([100103]);
  });

  it("ignores a job that has never run", () => {
    // A recurring job gets its `conversation_id` written back after the first
    // firing. Until then it owns no conversation, and every run would open a
    // new one.
    expect(
      scheduledConversations({ fresh: job({ prompt: "…" }) }).size,
    ).toBe(0);
  });

  it("counts a disabled job, which still names its conversation", () => {
    const ids = scheduledConversations({
      paused: job({ conversation_id: 7 }, { enabled: false }),
    });

    expect([...ids]).toEqual([7]);
  });

  it("ignores a conversation_id on any other channel", () => {
    // Another channel's payload may use the same field name for something
    // else; only `subagent.spawn` spawns into a named conversation.
    expect(
      scheduledConversations({
        other: job({ conversation_id: 9 }, { channel: "some.other.channel" }),
      }).size,
    ).toBe(0);
  });

  it("collects every job, and reports each conversation once", () => {
    const ids = scheduledConversations({
      a: job({ conversation_id: 1 }),
      b: job({ conversation_id: 2 }),
      // Two jobs can legitimately share one conversation.
      c: job({ conversation_id: 1 }),
    });

    expect([...ids].sort()).toEqual([1, 2]);
  });

  it("survives anything that is not the shape it expects", () => {
    for (const junk of [null, undefined, [], "jobs", 3, { a: null }, { a: 1 }]) {
      expect(scheduledConversations(junk).size).toBe(0);
    }
    // A payload that is present but not an object, and an id that is not one.
    expect(scheduledConversations({ a: job("nope") }).size).toBe(0);
    expect(scheduledConversations({ a: job({ conversation_id: "12" }) }).size).toBe(0);
    expect(scheduledConversations({ a: job({ conversation_id: 1.5 }) }).size).toBe(0);
  });
});
