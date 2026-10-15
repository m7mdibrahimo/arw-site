// The site's ads (owner 2026-10-15: none yet; «لما انزل في الموقع اعلانات … المشترك مش هيكون عنده اي اعلانات»).
//
// Every ad goes through here, so a member with «العضوية المميزة» never gets one, of any kind:
//   • scripts: an ad network's script address (AdSense, pop-under, push, in-page…). _includes/theme-init.njk loads each
//     one on every page, but only when window.arwShowAds() is true — never for a member with the membership.
//   • a spot for an ad inside a page: an element with class «arw-ad» (or the attribute data-arw-ad); it's hidden
//     for those members from the first paint, and the common networks' own elements are hidden for them too.
//   • a script written by hand anywhere else: wrap it in  if (window.arwShowAds && window.arwShowAds()) { … }
// A visitor and a free member see ads as everyone does; the membership's end brings them back, renewing takes them away.
module.exports = {
  scripts: [
    // { src: "https://…", attrs: { "data-…": "…" } },
  ],
};
