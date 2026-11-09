function toEmbedUrl(raw) {
  if (!raw || typeof raw !== "string") return "";
  let url = raw.trim();

  // Google Drive: the sharing link («/file/d/ID/view?usp=sharing», «/open?id=ID», «/uc?id=ID») -> its player «/file/d/ID/preview»
  // (owner 2026-10-16: «اني احط فقط اللينك وهو يتحول ل سيرفر امبيد لوحده»)
  url = url.replace(/^https?:\/\/(?:drive|docs)\.google\.com\/(?:file\/(?:u\/\d+\/)?d\/|open\?(?:[^#]*&)?id=|uc\?(?:[^#]*&)?id=)([a-zA-Z0-9_-]{10,})(?:[\/?#&].*)?$/i, "https://drive.google.com/file/d/$1/preview");

  // Ok.ru: /video/ID -> /videoembed/ID
  url = url.replace(/^https?:\/\/(?:m\.)?ok\.ru\/video\/(\d+)/i, "https://ok.ru/videoembed/$1");

  // VidTube: /ID.html -> /embed-ID.html
  url = url.replace(/^https?:\/\/(vidtube\.[a-z]+)\/(?!embed-)([a-zA-Z0-9_-]+)(?:\.html)?$/i, "https://$1/embed-$2.html");

  // Uqload: /ID.html -> /embed-ID.html
  url = url.replace(/^https?:\/\/(uqload\.[a-z]+)\/(?!embed-)([a-zA-Z0-9_-]+)(?:\.html)?$/i, "https://$1/embed-$2.html");

  // Streamtape: /v/ID/... -> /e/ID
  url = url.replace(/^https?:\/\/(streamtape\.[a-z]+)\/v\/([a-zA-Z0-9_-]+)(?:\/[^\s?]*)?/i, "https://$1/e/$2");

  // Doodstream: /d/ID -> /e/ID
  url = url.replace(/^https?:\/\/(dood(?:stream)?\.[a-z]+)\/d\/([a-zA-Z0-9_-]+)/i, "https://$1/e/$2");

  // VidMoly: /ID.html or /w/ID -> /embed-ID.html
  url = url.replace(/^https?:\/\/(?:[a-zA-Z0-9-]+\.)*(vidmoly\.[a-z]+)\/(?!embed-)(?:w\/)?([a-zA-Z0-9_-]+)(?:\.html)?(?:[\/?].*)?$/i, "https://$1/embed-$2.html");

  // StreamWish: /e/ID, /f/ID, or /ID -> /e/ID
  url = url.replace(/^https?:\/\/(?:streamwish\.[a-z]+|swish\.[a-z]+|wishfast\.[a-z]+|awish\.[a-z]+|mwish\.[a-z]+|sfastwish\.[a-z]+)\/(?:[fe]\/)?([a-zA-Z0-9_-]+)/i, "https://streamwish.to/e/$1");

  // StreamHG / HGCloud: /zyg5qa846siw -> /e/zyg5qa846siw (all mirror domains & subdomains). hgcloud.to sends
  // the player on to the current mirror (hanerix.com in Oct 2026), so a pasted mirror link goes back through it.
  url = url.replace(/^https?:\/\/(?:[a-zA-Z0-9-]+\.)*(?:hgcloud|streamhg|shgcloud|hgplayer|hgstream|hanerix)\.[a-zA-Z0-9-]+\/(?:[dfe]\/)?([a-zA-Z0-9_-]+)(?:[\/?].*)?$/i, "https://hgcloud.to/e/$1");

  // FileLions: /v/ID or /ID -> /v/ID
  url = url.replace(/^https?:\/\/(?:filelions\.[a-z]+|lion\.[a-z]+)\/(?:[vf]\/)?([a-zA-Z0-9_-]+)/i, "https://filelions.to/v/$1");

  // Fembed / Feurl: /v/ID or /f/ID -> /embed/ID
  url = url.replace(/^https?:\/\/([a-z0-9.-]*fe(?:mbed|url)[a-z0-9.-]*)\/[vf]\/([a-zA-Z0-9_-]+)/i, "https://$1/embed/$2");

  // The four file hosts the owner pastes plain share links from (owner 2026-11-09: «هحط بس اللينك … ويتحط iframe تلقائي»).
  // Each was opened in a real browser inside a page of this site (2026-11-09):
  //  - Send.now (old name send.cm): its player is /embed-ID.html, framable from any site. Send.now itself only plays a file
  //    there when it is 250 MB or less, or when the uploader's account has «Direct Link Traffic»; otherwise its player
  //    shows its own «plays with Premium» wall.
  //  - VikingFile (mirror domains vik1ngfile.site…): its own embed code is the file page vikingfile.com/f/ID, which in an
  //    iframe drops its menus and shows only the player, after Cloudflare's human check.
  //  - PixelDrain: its embed page refuses other sites (frame-ancestors 'self'); the file itself plays in a <video>, but
  //    only when the uploader's account is Pro («Hotlinking is only allowed on premium accounts»). The player tries the
  //    file and falls back to a «watch on PixelDrain» panel (assets/post-player.js).
  //  - GoFile: a /d/ID page refuses every frame (X-Frame-Options: DENY); only Premium «direct links» can be embedded. A /d/
  //    link is kept as it is and the player shows a «watch on GoFile» panel; a direct link plays in a <video>.
  url = url.replace(/^https?:\/\/(?:www\.)?send\.(?:now|cm)\/(?:embed-)?([a-z0-9]{12})(?:[\/.?#].*)?$/i, function(m, id) { return "https://send.now/embed-" + id.toLowerCase() + ".html"; });
  url = url.replace(/^https?:\/\/(?:www\.)?vik[i1]ngf[i1]le\.[a-z0-9-]+(?:\.[a-z0-9-]+)*\/(?:f|e|d|embed)\/([a-zA-Z0-9_-]+)(?:[\/?#].*)?$/i, "https://vikingfile.com/f/$1");
  url = url.replace(/^https?:\/\/(?:www\.)?pixeldrain\.(?:com|net)\/(?:u|api\/file)\/([a-zA-Z0-9_-]+)\/?(?:[?#].*)?$/i, "https://pixeldrain.com/api/file/$1");
  url = url.replace(/^https?:\/\/(?:www\.)?gofile\.io\/d\/([a-zA-Z0-9_-]+)\/?(?:[?#].*)?$/i, "https://gofile.io/d/$1");

  // LoadVid: loadvid.com/v/ID -> cdn.loadvid.com/videos/play/ID
  url = url.replace(/^https?:\/\/(?:cdn\.)?loadvid\.com\/(?:v|watch)\/([a-zA-Z0-9_-]+)/i, "https://cdn.loadvid.com/videos/play/$1");

  // TurboVid: /v/ID or /ID -> /t/ID
  url = url.replace(/^https?:\/\/turbovidhls\.com\/(?:v\/)?([a-zA-Z0-9_-]+)$/i, "https://turbovidhls.com/t/$1");

  // Voe: /ID -> /e/ID
  url = url.replace(/^https?:\/\/voe\.sx\/(?!e\/)([a-zA-Z0-9_-]+)$/i, "https://voe.sx/e/$1");

  // YouTube
  url = url.replace(/^https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]+).*/i, "https://www.youtube.com/embed/$1");
  url = url.replace(/^https?:\/\/youtu\.be\/([a-zA-Z0-9_-]+).*/i, "https://www.youtube.com/embed/$1");

  // Dailymotion
  url = url.replace(/^https?:\/\/(?:www\.)?dailymotion\.com\/video\/([a-zA-Z0-9_-]+).*/i, "https://www.dailymotion.com/embed/video/$1");
  url = url.replace(/^https?:\/\/dai\.ly\/([a-zA-Z0-9_-]+)/i, "https://www.dailymotion.com/embed/video/$1");

  // Vimeo
  url = url.replace(/^https?:\/\/(?:www\.)?vimeo\.com\/(\d+).*/i, "https://player.vimeo.com/video/$1");

  return url;
}

/**
 * How the player shows a server (after toEmbedUrl): «iframe» (the host's own player), «video» (the file itself in the
 * page's <video>) or «page» (a host that can't play inside another site: a panel with a link to the host's page).
 */
function playerKind(url) {
  const u = String(url || "");
  if (/^https:\/\/gofile\.io\/d\//i.test(u)) return "page";
  if (/^https:\/\/pixeldrain\.com\/api\/file\/[a-zA-Z0-9_-]+\/?(?:[?#]|$)/i.test(u) || /^https?:\/\/[a-z0-9-]+\.gofile\.io\/download\//i.test(u) || /\.(?:mp4|webm)(?:\?|$)/i.test(u)) return "video";
  return "iframe";
}

/** The host's own page for a server that may not play here ({name, href}), or null: the «شاهد على …» panel. */
function hostPage(url) {
  const u = String(url || "");
  let m = u.match(/^https:\/\/pixeldrain\.com\/api\/file\/([a-zA-Z0-9_-]+)/i);
  if (m) return { name: "PixelDrain", href: `https://pixeldrain.com/u/${m[1]}` };
  m = u.match(/^https:\/\/gofile\.io\/d\/([a-zA-Z0-9_-]+)/i);
  if (m) return { name: "GoFile", href: `https://gofile.io/d/${m[1]}` };
  return null;
}

/**
 * What the panel saves for a pasted watch link: a Send.now, VikingFile, PixelDrain or GoFile share link becomes its player
 * link (toEmbedUrl); every other link is kept exactly as it was typed (studio/js/views/editor.js).
 */
const FILE_HOSTS = ["send.now", "vikingfile.com", "pixeldrain.com", "gofile.io"];
function fileHostEmbed(raw) {
  const url = String(raw || "").trim();
  const out = toEmbedUrl(url);
  return out !== url && FILE_HOSTS.includes(hostOf(out)) ? out : url;
}

// Hosts whose pages refuse to be shown inside another site (X-Frame-Options: SAMEORIGIN):
// a server tab for them is a blank box. MultiUp is a download mirror page (INCIDENTS #276).
const NON_EMBEDDABLE = ["multiup.io", "multiup.org", "multiup.eu"];

function hostOf(raw) {
  try { return new URL(String(raw || "").trim()).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}

/**
 * The servers a viewer can actually play: drops hosts that refuse embedding and hosts the daily
 * check found dead (_data/videoHosts.json — turbovidhls.com lost its DNS in Oct 2026 and was the
 * dead tab on 180 shows). The show file keeps every link, so a host that comes back reappears.
 * Never returns an empty list when there were servers: one maybe-broken player beats none.
 */
// videoLinks: single links that failed a real playback test twice in a row (scripts/check-playback.ts,
// INCIDENTS #303) — the host answers, but that one file can't play, so only that server is hidden
function playableServers(servers, videoHosts, videoLinks) {
  const list = Array.isArray(servers) ? servers : [];
  const dead = new Set([...(videoHosts && videoHosts.dead || []), ...(videoHosts && videoHosts.noEmbed || []), ...NON_EMBEDDABLE]);
  const broken = new Set(videoLinks && videoLinks.broken || []);
  const kept = list.filter(s => s && s.url && !dead.has(hostOf(toEmbedUrl(s.url))) && !dead.has(hostOf(s.url)) && !broken.has(toEmbedUrl(s.url)) && !broken.has(String(s.url).trim()));
  // a server that may only open on its host's page (PixelDrain, GoFile) comes after the ones that play here, so the
  // page's play button starts a real player
  const out = kept.length ? kept : list;
  const later = s => (s && s.url && hostPage(toEmbedUrl(s.url)) ? 1 : 0);
  return out.some(later) ? [...out.filter(s => !later(s)), ...out.filter(later)] : out;
}

module.exports = { toEmbedUrl, playableServers, playerKind, hostPage, fileHostEmbed, hostOf, NON_EMBEDDABLE };
