import { describe, it, expect } from "vitest";
import { createOutlineDoc } from "../../doc/transactions";
import { getUserSetting, setUserSetting, deleteUserSetting, getTasksPaneShowCompleted, setTasksPaneShowCompleted } from "../userSettings";


describe("user settings", () => {
  it("reads/writes/deletes generic user setting", () => {
    const outline = createOutlineDoc();

    expect(getUserSetting(outline, "foo")).toBeNull();
    setUserSetting(outline, "foo", { a: 1 });
    expect(getUserSetting(outline, "foo")).toEqual({ a: 1 });
    deleteUserSetting(outline, "foo");
    expect(getUserSetting(outline, "foo")).toBeNull();
  });

  it("defaults tasks showCompleted to false and persists true", () => {
    const outline = createOutlineDoc();
    expect(getTasksPaneShowCompleted(outline)).toBe(false);
    setTasksPaneShowCompleted(outline, true);
    expect(getTasksPaneShowCompleted(outline)).toBe(true);
  });
});
