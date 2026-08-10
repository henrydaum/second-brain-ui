// @vitest-environment jsdom

/**
 * Where a notification sends you, in a DOM.
 *
 * The reducer underneath is covered without one, and the rows themselves are
 * ordinary markup — but the two links out of the panel are not, for the same
 * reason `input-request-dialog.dom.test.tsx` needs a DOM: what is worth pinning
 * is a contract with Radix (a popover that closes, a section that survives being
 * asked for) rather than any function written here.
 *
 * The provider is stubbed rather than rendered. What is under test is which
 * callback fires with which argument, and standing up a real provider would put
 * an SSE connection between the test and the assertion.
 */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NotificationPanel } from "@/components/notification-panel";
import { SettingsDialog } from "@/components/settings-dialog";
import type { Notification } from "@/lib/notifications";
import * as provider from "@/runtime/provider";

afterEach(cleanup);

const row = (over: Partial<Notification> = {}): Notification => ({
  id: 1,
  ts: 1_786_384_521,
  title: "Settings changed",
  body: "scheduled_jobs",
  source: "config",
  source_id: "core",
  level: "info",
  session_key: null,
  conversation_id: null,
  user_id: null,
  read_at: null,
  ...over,
});

function stub(over: Partial<provider.SecondBrain>) {
  const spies = {
    openSettings: vi.fn(),
    openConversation: vi.fn().mockResolvedValue(undefined),
    setNotificationsOpen: vi.fn(),
    markNotificationsRead: vi.fn().mockResolvedValue(undefined),
    clearSettingsRequest: vi.fn(),
    say: vi.fn().mockResolvedValue(true),
    dismissCommand: vi.fn(),
  };
  vi.spyOn(provider, "useSecondBrain").mockReturnValue({
    notifications: [],
    unread: 0,
    notificationsFailure: null,
    notificationsOpen: true,
    conversationId: 5,
    commands: [],
    state: { turns: [], typing: false },
    settingsRequest: null,
    ...spies,
    ...over,
  } as unknown as provider.SecondBrain);
  return { ...spies, user: userEvent.setup() };
}

describe("the links out of a notification", () => {
  it("drills into the setting the notification named", async () => {
    // Naming the setting is what makes `/config` skip its category and plugin
    // steps and land on that setting's own page. `all` is the category that
    // matches wherever the setting actually lives.
    const { say, openSettings, user } = stub({ notifications: [row()] });
    render(<NotificationPanel />);

    await user.click(screen.getByRole("button", { name: "Open settings" }));

    expect(say).toHaveBeenCalledWith("/config all scheduled_jobs");
    // And the dialog goes up now rather than a round trip later — which is also
    // where a failed submit lands.
    expect(openSettings).toHaveBeenCalledWith("config");
  });

  it("offers the section, once, when several settings changed", async () => {
    // Not a link each. The row is a line of 10px text, and the body directly
    // above already names them — so several links would repeat it in a less
    // readable form.
    const { say, openSettings, user } = stub({
      notifications: [row({ body: "http_port, http_token" })],
    });
    render(<NotificationPanel />);

    const links = screen.getAllByRole("button", { name: "Open settings" });
    expect(links).toHaveLength(1);

    await user.click(links[0]);

    // The section, with no attempt to guess which of the two you meant.
    expect(say).not.toHaveBeenCalled();
    expect(openSettings).toHaveBeenCalledWith("config");
  });

  it("falls back to the section when the body is not setting names", async () => {
    // `body` is a convention rather than a field. Prose must not be pasted onto
    // a command line.
    const { say, openSettings, user } = stub({
      notifications: [row({ body: "Several settings were updated." })],
    });
    render(<NotificationPanel />);

    await user.click(screen.getByRole("button", { name: "Open settings" }));

    expect(say).not.toHaveBeenCalled();
    expect(openSettings).toHaveBeenCalledWith("config");
  });

  it("closes the panel on the way out", async () => {
    // Otherwise the first thing you do in Settings is dismiss the popover
    // standing over it.
    const { setNotificationsOpen, user } = stub({ notifications: [row()] });
    render(<NotificationPanel />);

    await user.click(screen.getByRole("button", { name: "Open settings" }));

    expect(setNotificationsOpen).toHaveBeenCalledWith(false);
  });

  it("offers nothing for a source with nowhere to send you", () => {
    // Most notifications map to no section, and that is the honest answer — a
    // plugin registering has no settings page of its own to open.
    stub({ notifications: [row({ source: "plugin_watcher" })] });
    render(<NotificationPanel />);

    expect(screen.queryByRole("button", { name: "Open settings" })).toBeNull();
  });

  it("offers the conversation instead when there is one", async () => {
    const { openConversation, user } = stub({
      notifications: [
        row({ source: "subagents", title: "Agent finished", conversation_id: 9 }),
      ],
    });
    render(<NotificationPanel />);

    await user.click(screen.getByRole("button", { name: "Open chat" }));

    expect(openConversation).toHaveBeenCalledWith(9);
  });

  it("does not offer the conversation you are already in", () => {
    // `conversationId` is 5 in the stub. Offering to go where you are is a
    // button that does nothing and says it did something.
    stub({
      notifications: [row({ source: "subagents", conversation_id: 5 })],
    });
    render(<NotificationPanel />);

    expect(screen.queryByRole("button", { name: "Open chat" })).toBeNull();
  });
});

describe("Settings lands where it was asked to", () => {
  it("opens at the requested section rather than the default", () => {
    // Without this the link lands on "Agents and Models", which is the default
    // page and has nothing to do with a settings change.
    stub({ settingsRequest: { page: "config" } });
    render(<SettingsDialog open onOpenChange={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: "Configuration" }),
    ).toBeTruthy();
  });

  it("consumes the request instead of standing on it", () => {
    // A request that never cleared would undo the next navigation: press
    // "Security" and the still-standing `config` would put you back.
    const { clearSettingsRequest } = stub({
      settingsRequest: { page: "config" },
    });
    render(<SettingsDialog open onOpenChange={vi.fn()} />);

    expect(clearSettingsRequest).toHaveBeenCalled();
  });

  it("uses the default section when nothing asked for one", () => {
    stub({ settingsRequest: null });
    render(<SettingsDialog open onOpenChange={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: "Agents and Models" }),
    ).toBeTruthy();
  });
});
