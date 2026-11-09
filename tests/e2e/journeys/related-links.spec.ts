import { expect, test } from "./fixtures";

/**
 * Journey J-CONTENT-43: the "Keep reading" list at the end of the comparison pages
 * and the research page. Read-only. Each link must open a real page with the anchor
 * it was offered under, so the list is not a dead end and not a redirect.
 */

const PAGES: Record<string, string[]> = {
  "/indeed-alternative": ["/linkedin-jobs-alternative", "/eluta-alternative", "/research/ghost-jobs", "/blog/is-velai-legit"],
  "/linkedin-jobs-alternative": ["/indeed-alternative", "/eluta-alternative", "/research/ghost-jobs", "/blog/is-velai-legit"],
  "/eluta-alternative": ["/indeed-alternative", "/linkedin-jobs-alternative", "/research/ghost-jobs", "/blog/is-velai-legit"],
  "/research/ghost-jobs": ["/jobs", "/trends", "/blog/is-velai-legit", "/about"],
};

for (const [path, expected] of Object.entries(PAGES)) {
  test(`${path} ends with a Keep reading list that links ${expected.length} related pages`, { tag: ["@J-CONTENT-43"] }, async ({ page, request }) => {
    await page.goto(path);
    const list = page.getByTestId("related-pages");
    await expect(list.getByRole("heading", { name: "Keep reading" })).toBeVisible();
    const hrefs = await list.locator("a").evaluateAll((els) => els.map((a) => (a as HTMLAnchorElement).getAttribute("href")));
    expect(hrefs).toEqual(expected);
    for (const href of hrefs) {
      const res = await request.get(href!, { maxRedirects: 0 });
      expect(res.status(), `${path} -> ${href}`).toBe(200);
    }
  });
}
