import { useRecordDrawer } from "@/contexts/RecordDrawerContext";
import { recordDrawerRegistry } from "@/components/record-drawer/record-drawer-registry";

/**
 * DEV-ONLY test harness for the record-drawer Back-button behaviour.
 *
 * This page is registered as a route ONLY when `import.meta.env.DEV` is true
 * (see App.tsx), so it never ships in a production build. Its sole purpose is to
 * give the browser-level test (test/record-drawer-back-button-ui.test.ts) a
 * stable, data-free surface that drives the RecordDrawerContext API directly:
 * the Back-button / history mechanics under test live entirely in the context
 * and are independent of whatever record content a real drawer would show.
 *
 * Two layers of controls exist, mirroring the real app:
 *   - The PAGE controls (below) open the first level and exercise the
 *     replaceTopDrawer no-op at depth 0. They sit on the underlying page, which
 *     is only reachable while no drawer (and therefore no overlay) is open.
 *   - The IN-DRAWER controls (HarnessDrawerBody) open further levels and run
 *     the lateral "replace top" switch from inside the drawer — necessary
 *     because an open drawer's overlay covers the underlying page, exactly as a
 *     real nested drawer is opened from a control inside its parent.
 *
 * The drawer type "__harness__" is registered into the drawer registry only in
 * DEV (at the bottom of this file), so production builds never see it.
 */

function HarnessDrawerBody() {
  const { stack, openDrawer, replaceTopDrawer, closeAllDrawers } =
    useRecordDrawer();
  return (
    <div className="space-y-3" data-testid="harness-drawer-body">
      <div className="text-sm">
        In-drawer depth:{" "}
        <span data-testid="drawer-body-depth">{stack.length}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="drawer-open-more"
          onClick={() =>
            openDrawer({
              type: "__harness__",
              title: `Level ${stack.length + 1}`,
            })
          }
        >
          Open another level
        </button>
        <button
          type="button"
          data-testid="drawer-replace-top"
          onClick={() =>
            replaceTopDrawer({ type: "__harness__", title: "Swapped" })
          }
        >
          Replace this drawer
        </button>
        <button
          type="button"
          data-testid="drawer-close-all"
          onClick={() => closeAllDrawers()}
        >
          Close all
        </button>
      </div>
    </div>
  );
}

export default function DrawerTestHarnessPage() {
  const { stack, openDrawer, replaceTopDrawer } = useRecordDrawer();
  const top = stack[stack.length - 1];

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-xl font-semibold">Record Drawer Test Harness</h1>

      {/* State readouts the test asserts against. The page stays mounted while
          drawers are open, so these always reflect the live stack depth. */}
      <div className="space-y-1 text-sm">
        <div>
          Depth: <span data-testid="drawer-depth">{stack.length}</span>
        </div>
        <div>
          Top title:{" "}
          <span data-testid="drawer-top-title">{top ? top.title : ""}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="harness-open"
          onClick={() =>
            openDrawer({
              type: "__harness__",
              title: `Level ${stack.length + 1}`,
            })
          }
        >
          Open drawer
        </button>
        <button
          type="button"
          data-testid="harness-replace-noop"
          onClick={() =>
            replaceTopDrawer({ type: "__harness__", title: "Swapped" })
          }
        >
          Replace top (no-op at depth 0)
        </button>
      </div>
    </div>
  );
}

// Register the harness drawer body ONLY in development so production builds
// never expose this test-only drawer type.
if (import.meta.env.DEV) {
  recordDrawerRegistry["__harness__"] = HarnessDrawerBody;
}
