// English news (INCIDENTS #354): written by the news bots next to each new Arabic story (scripts/english-edition.ts).
// Rendered in the news layout at /en-src/news/<slug>/; lib/i18n/mirror.cjs then makes it /en/news/<slug>/ with the
// English interface and pairs it with its Arabic story. These files carry «en_tags», never «tags», so no Arabic tag
// page or list picks one up; every Arabic collection reads content/news/ only.
module.exports = {
  layout: "post-layout.njk",
  permalink: "/en-src/news/{{ slug or page.fileSlug }}/index.html",
};
