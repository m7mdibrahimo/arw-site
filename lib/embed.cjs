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

module.exports = { toEmbedUrl };
