import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { isShowEligible } from './show-reel-monitor';
const input = process.argv[2] || '';
const file = fs.existsSync(input) ? input : path.join('content/shows', input.replace(/\.md$/, '') + '.md');
try {
  process.exit(isShowEligible(path.basename(file), matter(fs.readFileSync(file, 'utf8')).data) ? 0 : 1);
} catch { process.exit(1); }
