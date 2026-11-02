import assert from "node:assert/strict";
import test from "node:test";
import { applySelectionRange, edgeScrollVelocity, nextCalendarDate, pageContaining, visibleDateCount } from "./grid-interaction";

test("container-based pagination fits minimum widths and preserves the old anchor after rotation", () => {
  const narrow = visibleDateCount(278, 52, 56, 14);
  assert.equal(narrow, 3);
  assert.ok((278 - 52 - 1) / narrow - 1 >= 56);
  const wide = visibleDateCount(586, 52, 56, 14);
  assert.equal(wide, 9);
  const oldFirst = 8;
  const nextFirst = pageContaining(oldFirst, wide, 14);
  assert.ok(nextFirst <= oldFirst && oldFirst < nextFirst + wide);
  assert.equal(visibleDateCount(80, 52, 56, 14), 1);
  assert.equal(visibleDateCount(2000, 52, 28, 14), 14);
});

test("painting a page retains selections on other dates and shrinking a preview restores its base", () => {
  const base = new Set(["off-page", "first"]);
  const expanded = applySelectionRange(base, ["first", "second", "third"], true);
  assert.deepEqual([...expanded], ["off-page", "first", "second", "third"]);
  const shrunk = applySelectionRange(base, ["first", "second"], true);
  assert.equal(shrunk.has("third"), false);
  const removed = applySelectionRange(base, ["first", "second"], false);
  assert.deepEqual([...removed], ["off-page"]);
  assert.deepEqual([...base], ["off-page", "first"]);
});

test("edge scrolling has bounded speed, ignores the center and stops at this grid's content ends", () => {
  assert.equal(edgeScrollVelocity(400, 120, 800, 0, 1200), 0);
  assert.equal(edgeScrollVelocity(100, 120, 800, 0, 1200), -520);
  assert.equal(edgeScrollVelocity(820, 120, 800, 0, 1200), 520);
  assert.equal(edgeScrollVelocity(780, 120, 800, 0, 1200), 260);
  assert.equal(edgeScrollVelocity(130, 120, 800, 120, 1200), 0);
  assert.equal(edgeScrollVelocity(790, 120, 800, 0, 800), 0);
  assert.equal(edgeScrollVelocity(100, 120, 100, 0, 1200), 0);
});


test("calendar arrow movement crosses months by date and retains weekday columns", () => {
  const dates = ["2026-11-28", "2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05"];
  assert.equal(nextCalendarDate(dates, "2026-11-30", 1), "2026-12-01");
  assert.equal(nextCalendarDate(dates, "2026-11-28", 7), "2026-12-05");
  assert.equal(nextCalendarDate(dates, "2026-12-05", -7), "2026-11-28");
  assert.equal(nextCalendarDate(dates, "2026-11-28", -1), "2026-11-28");
});
