/**
 * Browser checks shared by the e2e runs: a modal dialog (editor/Modal.tsx, a native <dialog> opened with showModal)
 * takes focus when it opens, keeps Tab inside, closes on Escape and on a press on the backdrop, gives focus back to
 * the control that opened it, and keeps editing shortcuts from reaching the window behind it.
 */
import type { Page } from "playwright-core";

type Check = (ok: unknown, what: string) => void;

/** Where focus is: "in" (inside the open dialog), "body", or a description of the element outside it. */
const focusIs = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return "body";
    if (a.closest("dialog.modal[open]")) return "in";
    return `${a.tagName.toLowerCase()}${a.getAttribute("aria-label") ? `[${a.getAttribute("aria-label")}]` : ""}${a.textContent ? ` "${a.textContent.trim().slice(0, 30)}"` : ""}`;
  });

/** The accessible name of the focused element (to check focus came back to the opener). */
const focusedName = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim() ?? "");

export interface DialogCase {
  /** The dialog's accessible name (its heading). */
  name: string | RegExp;
  /** Opens it with the opener focused (clicks it). */
  open(): Promise<void>;
  /** The opener's accessible name, which has focus again after the dialog closes. */
  opener: string | RegExp;
  /** What should have focus first, if not the first control (a test of the focused element). */
  first?: (page: Page) => Promise<boolean>;
  /** Presses shortcuts with the dialog open and says whether the window behind is unchanged. */
  shortcuts?: () => Promise<boolean>;
}

export async function checkDialog(page: Page, check: Check, c: DialogCase) {
  const dialog = page.getByRole("dialog", { name: c.name });
  const label = typeof c.name === "string" ? c.name : c.name.source;
  const matches = (s: string, want: string | RegExp) => (typeof want === "string" ? s === want : want.test(s));
  const closed = async () => {
    await page.locator("dialog.modal").waitFor({ state: "detached", timeout: 5000 });
    return true;
  };

  await c.open();
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  // A lazy-loaded dialog first shows a loading one of the same name (App.tsx, LoadingModal), which React swaps for its
  // own when the chunk arrives: check the dialog that stays, not one going away under the checks.
  await page.locator("dialog.modal .modal-body[role=status]", { hasText: "Loading…" }).waitFor({ state: "detached", timeout: 10000 });
  check(await dialog.evaluate((d) => d.tagName === "DIALOG" && (d as HTMLDialogElement).open && d.matches(":modal")), `${label}: a native modal <dialog>, named by its heading`);
  check((await focusIs(page)) === "in", `${label}: focus moves into it on open`);
  if (c.first) {
    let ok = false;
    for (let i = 0; i < 30 && !ok; i++) ok = (await c.first(page)) || (await page.waitForTimeout(100), false);
    check(ok, `${label}: the first sensible control has focus`);
  }

  // Tab and Shift+Tab never reach the page behind it (the browser's own UI, "body" here, is allowed between laps).
  const seen: string[] = [];
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press(i < 20 ? "Tab" : "Shift+Tab");
    seen.push(await focusIs(page));
  }
  const outside = seen.filter((f) => f !== "in" && f !== "body");
  check(outside.length === 0 && seen.filter((f) => f === "in").length >= 15, `${label}: Tab and Shift+Tab stay inside${outside.length ? ` (reached ${outside[0]})` : ""}`);

  if (c.shortcuts) check(await c.shortcuts(), `${label}: editing shortcuts do not reach the window behind it`);

  // Escape closes it, once, and focus returns to the opener.
  await page.keyboard.press("Escape");
  check(await closed(), `${label}: Escape closes it`);
  const back = await focusedName(page);
  check(matches(back, c.opener), `${label}: focus returns to the opener after Escape (${back || "nothing"})`);

  // A press on the backdrop closes it too.
  await c.open();
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  await page.mouse.click(4, 4);
  check(await closed(), `${label}: a click on the backdrop closes it`);
  const back2 = await focusedName(page);
  check(matches(back2, c.opener), `${label}: focus returns to the opener after a backdrop click (${back2 || "nothing"})`);

  // A press inside does not.
  await c.open();
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  await dialog.locator("h2").click();
  await page.waitForTimeout(200);
  check(await dialog.isVisible(), `${label}: a click inside leaves it open`);
  await dialog.getByRole("button", { name: "Close" }).click();
  check(await closed(), `${label}: the Close button closes it`);
}
