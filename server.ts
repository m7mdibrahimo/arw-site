import express from "express";
import path from "path";
import { execSync } from "child_process";
import fs from "fs";

const app = express();
const PORT = 3000;

function buildEleventy() {
  try {
    console.log("Building Eleventy site...");
    execSync("npx @11ty/eleventy", { stdio: "inherit" });
  } catch (err) {
    console.error("Eleventy build failed:", err);
  }
}

// Build site if _site/index.html doesn't exist yet
if (!fs.existsSync(path.join(process.cwd(), "_site", "index.html"))) {
  buildEleventy();
}

const sitePath = path.join(process.cwd(), "_site");

// Serve all static files from _site
app.use(express.static(sitePath, { index: ["index.html"] }));

// Route handler for pages
app.get("*", (req, res, next) => {
  let reqPath = req.path;
  let filePath = path.join(sitePath, reqPath);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    const indexPath = path.join(filePath, "index.html");
    if (fs.existsSync(indexPath)) {
      return res.sendFile(indexPath);
    }
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    return res.sendFile(filePath);
  }

  const htmlPath = filePath + ".html";
  if (fs.existsSync(htmlPath) && fs.statSync(htmlPath).isFile()) {
    return res.sendFile(htmlPath);
  }

  const defaultIndex = path.join(sitePath, "index.html");
  if (fs.existsSync(defaultIndex)) {
    return res.sendFile(defaultIndex);
  }

  res.status(404).send("Page Not Found");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Arab Wrestling site running on http://0.0.0.0:${PORT}`);
});
