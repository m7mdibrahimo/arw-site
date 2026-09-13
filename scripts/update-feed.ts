import fs from "node:fs";
import path from "node:path";

async function updateFeed() {
  const url = "https://www.fightful.com/wp-json/wp/v2/posts?_embed=1&per_page=30";
  console.log(`[Feed Updater] Fetching latest 30 posts from Fightful...`);

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const posts: any[] = await res.json();
    const clean = posts.map((p: any) => ({
      id: p.id,
      link: p.link,
      date: p.date,
      title: { rendered: p.title?.rendered || "" },
      featured_image: p._embedded?.["wp:featuredmedia"]?.[0]?.source_url || ""
    }));

    const targetFile = path.join(process.cwd(), "watcher-feed.json");
    fs.writeFileSync(targetFile, JSON.stringify(clean, null, 2), "utf-8");
    console.log(`[Feed Updater] ✅ Successfully updated watcher-feed.json (${clean.length} posts, ${(fs.statSync(targetFile).size / 1024).toFixed(1)} KB)`);
  } catch (err: any) {
    console.error(`[Feed Updater] ❌ Error updating feed:`, err.message);
    process.exit(1);
  }
}

updateFeed();
