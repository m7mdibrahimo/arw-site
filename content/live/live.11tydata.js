// «بث مباشر» (worker/src/live.ts): one file a show, written by arw-site-bot the moment any source posts the show, removed
// three days after it ends. Front matter only — the page (_includes/live-layout.njk) fills itself from /live/data.
// Kept out of every collection: not a show of the shows' listings, the library, the sitemap or the feeds.
module.exports = {
  layout: "live-layout.njk",
  permalink: (data) => (data.live_key ? `/live/${data.live_key}/index.html` : false),
  eleventyExcludeFromCollections: true,
};
