import { readFileSync } from 'fs';

const data = readFileSync('E:/File/文档/《北京化工大学本科生学习指南》（2024版）.pdf');
const latin = data.toString('latin1');

// Extract parenthesized strings from PDF content streams
const texts = [];
const re = /\(([^()]{3,150})\)/g;
let m;
while ((m = re.exec(latin)) !== null) {
  const raw = m[1];
  try {
    const s = Buffer.from(raw, 'latin1').toString('utf8');
    if (/[\u4e00-\u9fff]/.test(s) && s.length > 1) {
      texts.push(s.replace(/\s+/g, ' ').trim());
    }
  } catch(e) {}
}

const unique = [...new Set(texts)];
process.stdout.write(unique.slice(0, 500).join('\n') + '\n');
