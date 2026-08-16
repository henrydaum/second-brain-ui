/** @vitest-environment jsdom */

/**
 * What the file viewer has to get right that looking at it will not tell you.
 *
 * **The SVG sandbox.** An SVG handed to a framing element is a *document* at
 * this app's origin, and the production gateway credentials same-origin `/sdk`
 * calls — so a script inside one would be able to read and write the host
 * without ever learning the token. `sandbox=""` is what withholds scripting,
 * and `<embed>`, which is what this used to be, cannot express it at all. The
 * pane looks identical either way; only a hostile file tells them apart.
 *
 * **The Markdown renderer, for the same reason twice over.** Raw HTML in a note
 * is the same hole by another route, and a relative link that the browser
 * follows navigates the whole app away from the conversation. Both are quiet
 * failures — the first is invisible until it is exploited, the second until
 * somebody clicks — so both are pinned here.
 */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FileView } from "@/components/file-view";
import { forgetFile } from "@/lib/files";

// Testing Library only registers its own cleanup when the test globals are
// exposed, and this project runs vitest without them — so two renders would
// otherwise both be in the document and the query would answer with the first.
afterEach(cleanup);

describe("an SVG in the file viewer", () => {
  // `.svg` is decided by extension in `kindOf`, before anything is asked of the
  // server, so this needs no stubbing to reach the branch under test.
  it("renders sandboxed, with scripting withheld", async () => {
    render(<FileView path="/tmp/diagram.svg" />);

    const frame = await screen.findByTitle("diagram.svg");
    expect(frame.tagName).toBe("IFRAME");
    // Present and empty. An absent attribute is no sandbox at all, and any
    // value containing `allow-scripts` hands the origin straight back.
    expect(frame).toHaveAttribute("sandbox", "");
  });

  it("keeps the box it always had", async () => {
    render(<FileView path="/tmp/diagram.svg" size="full" />);

    const frame = await screen.findByTitle("diagram.svg");
    expect(frame).toHaveClass("w-full", "rounded-lg", "border", "h-full");
  });
});

describe("a Markdown file in the file viewer", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  /** One `/files` answer holding a whole file, and a path nothing else in this
   *  suite has read — `readText` caches by path and would otherwise hand the
   *  next test the previous test's note. */
  let served = 0;
  function serve(text: string): string {
    const bytes = new TextEncoder().encode(text);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => bytes.buffer,
    });
    const path = `/srv/vault/note-${served++}.md`;
    forgetFile(path);
    return path;
  }

  it("renders the note rather than printing its source", async () => {
    const path = serve("# Monday\n\nWrite it **down**.\n");
    render(<FileView path={path} />);

    await screen.findByRole("heading", { level: 1, name: "Monday" });
    expect(screen.getByText("down").tagName).toBe("STRONG");
  });

  it("shows front matter as metadata instead of as a giant heading", async () => {
    // Left to CommonMark, the closing fence turns `title: Weekly plan` into a
    // setext `<h2>` under a rule — the top of every vault note reading like a
    // bug. See `splitFrontMatter`.
    const path = serve("---\ntitle: Weekly plan\n---\n# Monday\n");
    render(<FileView path={path} />);

    await screen.findByRole("heading", { level: 1, name: "Monday" });
    expect(screen.getByText("Weekly plan")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /title:/ })).toBeNull();
  });

  it("drops raw HTML rather than letting a file into this origin", async () => {
    // The same hole `sandbox=""` closes for SVG, by another route: this app's
    // origin is one the gateway credentials, so markup out of a file must not
    // become markup in the page. `react-markdown` refuses it unless
    // `rehype-raw` is added, and this is what says never add it.
    const path = serve(
      'Hello <img src="x" onerror="alert(1)"> <script>alert(2)</script>\n',
    );
    const { container } = render(<FileView path={path} />);

    await screen.findByText(/Hello/);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("fetches a relative image from the host, not from this app", async () => {
    const path = serve("![chart](attachments/chart.png)\n");
    const { container } = render(<FileView path={path} />);

    const image = await waitFor(() => {
      const found = container.querySelector("img");
      expect(found).not.toBeNull();
      return found as HTMLImageElement;
    });
    expect(image.getAttribute("src")).toContain(
      `path=${encodeURIComponent("/srv/vault/attachments/chart.png")}`,
    );
  });

  it("points a link to a neighbouring note at that note", async () => {
    const path = serve(
      "[the plan](notes/plan.md) and [a site](https://x.test)\n",
    );
    render(<FileView path={path} />);

    const neighbour = await screen.findByRole("link", { name: "the plan" });
    // A real `/files` URL, so a ⌘-click still means something — the click
    // handler is what keeps a plain one from navigating the app away.
    expect(neighbour.getAttribute("href")).toContain(
      `path=${encodeURIComponent("/srv/vault/notes/plan.md")}`,
    );
    expect(neighbour).not.toHaveAttribute("target");

    // Off-site goes off-site, and takes nothing with it.
    const offsite = screen.getByRole("link", { name: "a site" });
    expect(offsite).toHaveAttribute("href", "https://x.test");
    expect(offsite).toHaveAttribute("target", "_blank");
    expect(offsite.getAttribute("rel")).toContain("noreferrer");
  });

  it("shows the source on request, and remembers that for the next file", async () => {
    const user = userEvent.setup();
    // The highlighter splits a line into a span per token, so the source is
    // read off the block as a whole rather than looked up as a run of text.
    const sourceIn = (root: HTMLElement) =>
      root.querySelector("pre")?.textContent ?? "";

    const first = serve("# Monday\n");
    const one = render(<FileView path={first} />);

    await screen.findByRole("heading", { level: 1, name: "Monday" });
    await user.click(screen.getByRole("button", { name: "Source" }));
    expect(screen.queryByRole("heading", { name: "Monday" })).toBeNull();
    expect(sourceIn(one.container)).toContain("# Monday");

    // The preference is a mood, not a setting: it follows you to the next file
    // so that wanting source does not mean clicking for it all day.
    one.unmount();
    const second = serve("# Tuesday\n");
    const two = render(<FileView path={second} />);

    await waitFor(() => expect(sourceIn(two.container)).toContain("# Tuesday"));
    expect(screen.queryByRole("heading", { name: "Tuesday" })).toBeNull();

    // Put it back, so the default this suite started from is the default the
    // next test sees.
    await user.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByRole("heading", { level: 1, name: "Tuesday" });
  });
});
