// www.arab-wrestling.com served the whole site with 200, so Google saw every page
// twice ("Duplicate, Google chose different canonical" in Search Console).
// This route-bound Worker 301s every www URL to the same path on the apex domain.
export default {
  fetch(request) {
    const url = new URL(request.url);
    url.hostname = "arab-wrestling.com";
    url.protocol = "https:";
    return Response.redirect(url.toString(), 301);
  },
};
