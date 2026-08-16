import fs from "fs";
import path from "path";
import { PDFParse } from "pdf-parse";

const SRC = path.resolve("../JEE MAIN ADVANCE");
const files = fs
  .readdirSync(SRC)
  .filter((f) => f.toLowerCase().endsWith(".pdf"))
  .sort();

for (const file of files) {
  const buf = fs.readFileSync(path.join(SRC, file));
  const parser = new PDFParse({ data: buf });
  const result = await parser.getText();
  const text = result?.text || "";
  const out = path.join(SRC, file.replace(/\.pdf$/i, ".txt"));
  fs.writeFileSync(out, text);
  const qCount = (text.match(/Q\.\s*\d+/g) || []).length;
  console.log(`${file}: chars=${text.length} questions~=${qCount}`);
}
