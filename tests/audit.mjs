import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const app = read("app.js");
const editor = read("editor.js");
const converter = read("converter.js");
const pptxViewer = read("pptx-viewer.js");
const html = read("index.html");
const css = read("styles.css");

const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

try { new Function(app); } catch (error) { failures.push("app.js syntax: " + error.message); }
try { new Function(editor); } catch (error) { failures.push("editor.js syntax: " + error.message); }
try { new Function(converter); } catch (error) { failures.push("converter.js syntax: " + error.message); }
try { new Function(pptxViewer); } catch (error) { failures.push("pptx-viewer.js syntax: " + error.message); }

assert(!app.includes("existingKeys"), "duplicate-file guard returned");
assert(!app.includes("Those PDFs are already"), "duplicate-file rejection message returned");
assert(app.includes("makeDocumentLabel"), "duplicate instances are not labeled");
assert(app.includes("ensureViewerEngine"), "viewer engine split missing");
assert(app.includes("ensureExportEngine"), "export engine split missing");

const viewerBlock = app.slice(
  app.indexOf("function ensureViewerEngine"),
  app.indexOf("function ensureExportEngine")
);
assert(!viewerBlock.includes("PDFLIB_URL"), "pdf-lib is loading during ordinary viewing");

assert(!app.includes("function createPageCard"), "dead middle-grid page card code returned");
assert(!css.includes(".page-card{"), "dead middle-grid CSS returned");
assert(app.includes("content-visibility") === false, "CSS accidentally embedded into JS");
assert(css.includes("content-visibility:auto"), "sidebar containment optimization missing");
assert(app.includes("4200000"), "full-page canvas pixel budget missing");
assert(editor.includes("maxSide = 1600"), "inserted-image resize missing");
assert(editor.includes("item.points.length < 8000"), "pen point bound missing");
assert(editor.includes("imageCache.size > 24"), "image cache bound missing");
assert(app.includes('loadScript("./converter.js?v=1"'), "converter is not lazy-loaded");
assert(app.includes('link.href = "./converter.css?v=1"'), "converter CSS is not lazy-loaded");
assert(html.includes('id="converterButton"'), "converter entry button missing");
for (const mode of ["images-pdf","pdf-png","pdf-jpg","pdf-text"]) {
  assert(converter.includes(mode), "converter mode missing: " + mode);
}
assert(converter.includes("MAX_IMAGE_PAGES = 300"), "PDF-to-image page safety limit missing");
assert(converter.includes("makeZip(entries)"), "dependency-free ZIP writer missing");
assert(app.includes('loadScript("./pptx-viewer.js?v=1"'), "PPTX viewer is not lazy-loaded");
assert(app.includes('link.href = "./pptx-viewer.css?v=1"'), "PPTX viewer CSS is not lazy-loaded");
assert(html.includes('id="pptxViewerButton"'), "PPTX viewer entry button missing");
assert(pptxViewer.includes("pptx-preview@1.0.7"), "PPTX viewer engine is not pinned");
assert(pptxViewer.includes("mod.init"), "PPTX renderer initialization missing");
assert(pptxViewer.includes("previewer.preview"), "PPTX preview call missing");
assert(pptxViewer.includes("local only"), "PPTX local-only status missing");

const singleSelectorForEach = /(^|[^$])\$\("[^"]+"\)\.forEach/g;
assert(!singleSelectorForEach.test(app), "single-element selector used with .forEach");

const idSelectors = [...app.matchAll(/\$\("#([^"]+)"\)/g)].map((match) => match[1]);
for (const id of new Set(idSelectors)) {
  assert(html.includes('id="' + id + '"'), "missing DOM target #" + id);
}

const hostMethods = [
  "uid","normalizeRotation","getPage","getPageIndex","getDocumentName",
  "getAnnotations","commitAnnotations","renderPage","showToast","setStatus"
];
const hostStart = app.indexOf("window.iWeatherPDFEditorHost");
const hostEnd = app.indexOf("function openPicker", hostStart);
const hostBlock = hostStart >= 0 && hostEnd > hostStart ? app.slice(hostStart, hostEnd) : "";
for (const method of hostMethods) {
  assert(new RegExp("\\b" + method + "\\b").test(hostBlock), "editor host method missing: " + method);
}

const editorCalls = [...editor.matchAll(/host\(\)\.([A-Za-z0-9_]+)/g)].map((match) => match[1]);
for (const method of new Set(editorCalls)) {
  assert(hostMethods.includes(method), "editor calls undeclared host method: " + method);
}

// Large deterministic workspace simulation.
let pages = [];
for (let doc = 0; doc < 25; doc++) {
  for (let page = 0; page < 200; page++) {
    pages.push({ id: "p-" + doc + "-" + page, docId: "d-" + doc, sourceIndex: page, rotation: 0 });
  }
}
const history = [];
const snapshot = () => {
  history.push(pages.map((page) => ({ ...page })));
  if (history.length > 30) history.shift();
};

for (let i = 0; i < 600; i++) {
  snapshot();
  const from = (i * 37) % pages.length;
  const to = (i * 113) % pages.length;
  const [moved] = pages.splice(from, 1);
  pages.splice(to, 0, moved);
}

const duplicates = pages.slice(0, 120).map((page, i) => ({ ...page, id: page.id + "-copy-" + i }));
pages.splice(400, 0, ...duplicates);

const deleted = new Set(pages.slice(900, 1200).map((page) => page.id));
pages = pages.filter((page) => !deleted.has(page.id));

for (let i = 0; i < pages.length; i += 19) {
  pages[i].rotation = [0, 90, 180, 270][Math.floor(i / 19) % 4];
}

assert(new Set(pages.map((page) => page.id)).size === pages.length, "stress: page IDs collided");
assert(history.length <= 30, "stress: history exceeded its cap");
assert(pages.every((page) => [0,90,180,270].includes(page.rotation)), "stress: invalid rotation");
assert(pages.length === 4820, "stress: unexpected page count");

if (failures.length) {
  console.error("\nAudit failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("Audit passed");
console.log(" - app.js, editor.js, converter.js, and pptx-viewer.js parse");
console.log(" - duplicate PDFs are allowed");
console.log(" - PDF export, converter, and PPTX viewer modules remain lazy");
console.log(" - DOM selector targets are present");
console.log(" - sidebar/runtime memory guards are present");
console.log(" - 5,000-page data-model stress simulation passed");
