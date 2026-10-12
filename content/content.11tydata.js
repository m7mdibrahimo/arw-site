// A name never says the same thing twice in a row on the site, whatever a file holds (INCIDENTS #462): «TNA TNA Bound For
// Glory» showed in the path, the program's box and «عن العرض». The title stays as written here (the address comes from it);
// the panel and its server clean every name before it is saved (studio/js/names.js, worker/src/studio.ts).
const { collapseRepeatedNames } = require("../lib/names.cjs");

module.exports = {
  eleventyComputed: {
    program_name: (data) => collapseRepeatedNames(data.program_name),
    headline: (data) => collapseRepeatedNames(data.headline),
    library_federation: (data) => collapseRepeatedNames(data.library_federation),
  },
};
