// «النشر السريع» (fast lane, INCIDENTS #1296): a panel save shows on the live site in about a minute instead of after the
// whole ~4-minute Cloudflare rebuild. This is the render half: the same Eleventy build with the same templates, data and
// transforms, but only the saved pages and the listings that show them («/», «/shows/», «/news/») are rendered and
// written. Every other page is still read and its data computed (the listings need the whole collections), it is just
// never rendered. The heavy after-steps (English copy, redirect pages, file count, picture cache) are left out; the
// scripts' and styles' minify-and-name step runs as in the real build, so the pages link to the same file names.
//
// ARW_FAST_LANE="content/shows/a.md,content/news/b.md" turns it on. The pages written are listed in _site/fast-lane.json.
// Nothing here runs in a normal build.
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const LISTINGS = ["index.html", "shows/index.html", "news/index.html"];

/** The inputs asked for, as Eleventy names them («./content/shows/a.md») */
function parseInputs(env = process.env.ARW_FAST_LANE) {
  return String(env || "")
    .split(/[,\n]/)
    .map((s) => s.trim().replace(/^\.\//, ""))
    .filter((s) => /^content\/(shows|news)\/[^/]+\.md$/.test(s))
    .map((s) => "./" + s);
}

function enabled(env = process.env.ARW_FAST_LANE) {
  return env !== undefined && env !== "";
}

/** Whether a page is one the fast lane writes: a saved page, or the first page of a listing */
function wanted(page, inputs, outDir) {
  if (inputs.has(page.inputPath)) return true;
  const out = String(page.outputPath || "").replace(/\\/g, "/").replace(/^\.\//, "");
  const rel = out.startsWith(outDir + "/") ? out.slice(outDir.length + 1) : out;
  return LISTINGS.includes(rel);
}

/** Patches Eleventy's own Template/TemplateMap (the same module instances the build uses) so only the wanted pages render */
async function install(inputsList, outDir = "_site") {
  const inputs = new Set(inputsList);
  const src = path.dirname(require.resolve("@11ty/eleventy"));
  const Template = (await import(pathToFileURL(path.join(src, "Template.js")).href)).default;
  const TemplateMap = (await import(pathToFileURL(path.join(src, "TemplateMap.js")).href)).default;
  const written = [];
  if (!Template.prototype.__arwFastLane) {
    const generate = Template.prototype.generateMapEntry;
    Template.prototype.generateMapEntry = function (mapEntry, to) {
      const keep = mapEntry._pages.filter((p) => wanted(p, inputs, outDir));
      if (!keep.length) return Promise.resolve([]);
      for (const p of keep) written.push({ url: p.url, outputPath: String(p.outputPath).replace(/\\/g, "/").replace(/^\.\//, ""), inputPath: p.inputPath });
      return generate.call(this, { ...mapEntry, _pages: keep }, to);
    };
    // a page's body without its layout («templateContent») is rendered first for every page: only the wanted pages'
    // are needed (the RSS feed, the one listing that reads other pages' bodies, is not one of them). A page that did
    // read an unrendered body fails the fast build loudly, and that save simply waits for the full build.
    const populate = TemplateMap.prototype.populateContentDataInMap;
    TemplateMap.prototype.populateContentDataInMap = function (orderedMap) {
      return populate.call(this, orderedMap.filter((entry) => (entry._pages || []).some((p) => wanted(p, inputs, outDir))));
    };
    Template.prototype.__arwFastLane = true;
  }
  return written;
}

/** The list of written pages, for the upload step */
function writeManifest(written, outDir = "_site") {
  const pages = written
    .filter((w) => w.url && fs.existsSync(w.outputPath))
    .map((w) => ({ url: w.url, file: path.relative(outDir, w.outputPath).replace(/\\/g, "/"), input: w.inputPath.replace(/^\.\//, "") }));
  fs.writeFileSync(path.join(outDir, "fast-lane.json"), JSON.stringify({ pages }, null, 1));
  return pages;
}

module.exports = { parseInputs, enabled, wanted, install, writeManifest, LISTINGS };
