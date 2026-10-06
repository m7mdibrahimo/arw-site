function toEmbedUrl(raw) {
  if (!raw || typeof raw !== "string") return "";
  let url = raw.trim();

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

  // PixelDrain: /u/ID -> /api/file/ID
  url = url.replace(/^https?:\/\/pixeldrain\.com\/u\/([a-zA-Z0-9_-]+)(?:\?.*)?$/i, "https://pixeldrain.com/api/file/$1");

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
function playableServers(servers, videoHosts) {
  const list = Array.isArray(servers) ? servers : [];
  const dead = new Set([...(videoHosts && videoHosts.dead || []), ...(videoHosts && videoHosts.noEmbed || []), ...NON_EMBEDDABLE]);
  const kept = list.filter(s => s && s.url && !dead.has(hostOf(toEmbedUrl(s.url))) && !dead.has(hostOf(s.url)));
  return kept.length ? kept : list;
}

module.exports = { toEmbedUrl, playableServers, hostOf, NON_EMBEDDABLE };
