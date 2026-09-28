const fs = require("node:fs");
const { chromium } = require("@playwright/test");

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Pass the JSON output of the PowerPoint canvas render_slide action.");
  const slides = JSON.parse(fs.readFileSync(file, "utf8")).result.render.slides;
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const failures = [];
  try {
    const page = await browser.newPage();
    for (const slide of slides) {
      await page.setContent(slide.svg);
      const issues = await page.evaluate(() => Array.from(document.querySelectorAll("g[data-shape-text]")).flatMap(group => {
        const rectangle = group.previousElementSibling;
        if (!rectangle || rectangle.tagName.toLowerCase() !== "rect") return [];
        const bounds = group.getBBox();
        const x = Number(rectangle.getAttribute("x"));
        const y = Number(rectangle.getAttribute("y"));
        const width = Number(rectangle.getAttribute("width"));
        const height = Number(rectangle.getAttribute("height"));
        return bounds.x < x - 3 || bounds.y < y - 3 || bounds.x + bounds.width > x + width + 3 || bounds.y + bounds.height > y + height + 3
          ? [{ shape: group.getAttribute("data-shape-text"), text: group.textContent.slice(0, 120) }] : [];
      }));
      if (issues.length) failures.push({ slide: slide.index + 1, issues });
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ slidesInspected: slides.length, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
