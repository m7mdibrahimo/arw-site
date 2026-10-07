const path = require("path");
const { showPath } = require("../../lib/show-permalink.cjs");

module.exports = {
  layout: "post-layout.njk",
  eleventyComputed: {
    // Title-based URL, made unique when two shows share a title (lib/show-permalink.cjs).
    permalink: data => `${showPath(path.basename(data.page.inputPath), data.title)}index.html`,
  },
};
