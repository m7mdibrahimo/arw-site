const path = require("path");
const { showPath } = require("../../lib/show-permalink.cjs");
const { tourProgramOf } = require("../../lib/tours.cjs");

module.exports = {
  layout: "post-layout.njk",
  eleventyComputed: {
    // Title-based URL, made unique when two shows share a title (lib/show-permalink.cjs).
    permalink: data => `${showPath(path.basename(data.page.inputPath), data.title)}index.html`,
    // NJPW shows go to their tour's own program («NJPW Destruction in Kobe 2026»), worked out from the titles (lib/tours.cjs)
    program_name: data => tourProgramOf(path.basename(data.page.inputPath), data.program_name) || data.program_name,
  },
};
