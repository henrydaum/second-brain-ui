/** @vitest-environment jsdom */

/**
 * The one security property this renderer has to keep.
 *
 * An SVG handed to a framing element is a *document* at this app's origin, and
 * the production gateway credentials same-origin `/sdk` calls — so a script
 * inside one would be able to read and write the host without ever learning the
 * token. `sandbox=""` is what withholds scripting, and `<embed>`, which is what
 * this used to be, cannot express it at all.
 *
 * Pinned in a test because the failure is invisible: the pane looks right
 * either way, and only a hostile file tells the two apart.
 */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FileView } from "@/components/file-view";

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
