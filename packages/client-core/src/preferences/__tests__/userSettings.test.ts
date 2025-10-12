import { describe, expect, it } from "vitest";

import { createOutlineDoc } from "../../doc";
import {
  deleteUserSetting,
  getUserSetting,
  getUserSettingSnapshot,
  setUserSetting
} from "../userSettings";

describe("userSettings", () => {
  it("stores and retrieves primitive values", () => {
    const outline = createOutlineDoc();

    setUserSetting(outline, "theme", "dark");

    expect(getUserSetting(outline, "theme")).toBe("dark");
    const snapshot = getUserSettingSnapshot(outline, "theme");
    expect(snapshot).not.toBeNull();
    expect(snapshot?.value).toBe("dark");
    expect(snapshot?.updatedAt).toBeGreaterThan(0);
  });

  it("serialises structured values", () => {
    const outline = createOutlineDoc();
    const value = { palette: "sunset", contrast: "high" };

    setUserSetting(outline, "palette", value);

    expect(getUserSetting(outline, "palette")).toEqual(value);
  });

  it("deletes values within transactions", () => {
    const outline = createOutlineDoc();
    setUserSetting(outline, "keyboard", "vim");

    deleteUserSetting(outline, "keyboard");

    expect(getUserSetting(outline, "keyboard")).toBeNull();
  });
});
