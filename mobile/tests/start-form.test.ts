import { mount, tick, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App.svelte";
import { activityYaml } from "../src/lib/activity-files";
import { createActivityRecord } from "../../src/shared/activity";

const bridge = vi.hoisted(() => ({
  getConnection: vi.fn(),
  getActiveActivity: vi.fn(),
  selectActivity: vi.fn(),
  clearSelection: vi.fn(),
  addListener: vi.fn(),
  requestNotificationPermission: vi.fn(),
  listFiles: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));
const files = vi.hoisted(() => ({
  listFiles: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));
vi.mock("../src/lib/activity-notifications", () => ({
  ActivityNotifications: bridge,
  vaultFiles: files,
}));

let app: ReturnType<typeof mount>;

function button(text: string) {
  const found = [...document.querySelectorAll("button")].find((element) =>
    element.textContent?.includes(text),
  );
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}

async function render() {
  app = mount(App, { target: document.body });
  await vi.waitFor(() => expect(button("Read").disabled).toBe(false));
}

describe("opening mobile start forms", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(
      new Date("2026-10-07T12:00:00").getTime(),
    );
    bridge.getConnection.mockResolvedValue({ connected: true, name: "Vault" });
    bridge.getActiveActivity.mockResolvedValue({ active: false });
    bridge.addListener.mockResolvedValue({ remove: vi.fn() });
    bridge.requestNotificationPermission.mockResolvedValue({ granted: true });
    files.listFiles.mockResolvedValue([]);
    files.readFile.mockResolvedValue(null);
    bridge.listFiles.mockResolvedValue({ paths: [] });
  });
  afterEach(async () => {
    if (app) await unmount(app);
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("opens inputs while resource enumeration is still pending, without refreshing history", async () => {
    bridge.listFiles.mockReturnValue(new Promise(() => {}));
    await render();
    files.listFiles.mockClear();
    button("Read").click();
    await tick();
    await vi.waitFor(() =>
      expect(document.querySelector('input[name="book"]')).not.toBeNull(),
    );
    expect(button("Save").disabled).toBe(false);
    expect(document.body.textContent).toContain("Loading suggestions");
    expect(files.listFiles).not.toHaveBeenCalled();
    expect(bridge.getConnection).toHaveBeenCalledTimes(1);
    expect(bridge.listFiles).toHaveBeenCalledWith({ extension: ".md" });
  });

  it("adds resource options after slow reads finish without resetting input values", async () => {
    let resolve!: (contents: string) => void;
    bridge.listFiles.mockResolvedValue({ paths: ["Books/Remote book.md"] });
    files.readFile.mockReturnValue(
      new Promise<string>((done) => {
        resolve = done;
      }),
    );
    await render();
    button("Read").click();
    await vi.waitFor(() =>
      expect(document.querySelector('input[name="book"]')).not.toBeNull(),
    );
    const input =
      document.querySelector<HTMLInputElement>('input[name="book"]')!;
    input.value = "My typed book";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    resolve("---\ntags: [book]\n---\n");
    await vi.waitFor(() =>
      expect(
        document.querySelector('option[value="Remote book"]'),
      ).not.toBeNull(),
    );
    expect(input.value).toBe("My typed book");
    expect(document.body.textContent).not.toContain("Loading suggestions");
  });

  it("keeps the form usable when resource loading fails", async () => {
    await render();
    bridge.listFiles.mockRejectedValue(new Error("Vault unavailable"));
    button("Read").click();
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("Vault unavailable"),
    );
    expect(document.querySelector('input[name="book"]')).not.toBeNull();
    expect(button("Save").disabled).toBe(false);
  });

  it("reuses an in-flight resource scan when cancelling and choosing again", async () => {
    bridge.listFiles.mockReturnValue(new Promise(() => {}));
    await render();
    button("Read").click();
    await vi.waitFor(() => expect(button("Cancel").disabled).toBe(false));
    button("Cancel").click();
    await tick();
    button("Read").click();
    await vi.waitFor(() => expect(button("Save").disabled).toBe(false));
    expect(bridge.listFiles).toHaveBeenCalledTimes(1);
  });

  it("keeps the plugin's reading page defaults while resources are still loading", async () => {
    const read = createActivityRecord(
      "read",
      { book: "Shared book", "start-page": 1 },
      "2026-10-07 10:00:00",
    );
    read.read = { ...read.read, "end-page": 25 };
    read.log![0].end = "2026-10-07 10:30:00";
    files.listFiles.mockResolvedValue([
      "_Planner/activities/2026/2026-W41.yaml",
    ]);
    files.readFile.mockResolvedValue(
      activityYaml.stringify({ activities: [read] }),
    );
    bridge.listFiles.mockReturnValue(new Promise(() => {}));
    await render();
    button("Shared book").click();
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLInputElement>('input[name="start-page"]')
          ?.value,
      ).toBe("26"),
    );
    expect(
      document.querySelector<HTMLInputElement>('input[name="book"]')?.value,
    ).toBe("Shared book");
    expect(files.readFile).toHaveBeenCalledTimes(1);
  });

  it("opens non-resource forms without any vault reads", async () => {
    await render();
    files.listFiles.mockClear();
    button("Movie").click();
    await vi.waitFor(() =>
      expect(document.querySelector('input[name="name"]')).not.toBeNull(),
    );
    expect(files.listFiles).not.toHaveBeenCalled();
    expect(files.readFile).not.toHaveBeenCalled();
    expect(bridge.listFiles).not.toHaveBeenCalled();
  });

  it("saves using the latest weekly YAML even though the form did not refresh history", async () => {
    await render();
    // A remote edit arrives after the suggestion list was displayed.
    const remote = createActivityRecord(
      "movie",
      { name: "Remote film" },
      "2026-10-07 10:00:00",
    );
    remote.notes = "Remote note to preserve";
    const contents = activityYaml.stringify({
      activities: [remote],
    });
    files.readFile.mockResolvedValue(contents);
    button("Movie").click();
    await vi.waitFor(() =>
      expect(document.querySelector('input[name="name"]')).not.toBeNull(),
    );
    const input =
      document.querySelector<HTMLInputElement>('input[name="name"]')!;
    input.value = "New film";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    button("Save").click();
    await vi.waitFor(() => expect(files.writeFile).toHaveBeenCalled());
    const [path, written, expected] = files.writeFile.mock.calls[0];
    expect(path).toMatch(/^_Planner\/activities\/\d{4}\/\d{4}-W\d{2}\.yaml$/);
    expect(expected).toBe(contents);
    expect(activityYaml.parse(written)).toMatchObject({
      activities: [remote, { activity: "movie", movie: { name: "New film" } }],
    });
    expect(files.readFile).toHaveBeenCalled();
  });
});
