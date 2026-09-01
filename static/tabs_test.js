// run with: node static/tabs_test.js
// H1T4 tabs + sortable headers contract — expects role=tablist, data-tab, aria-sort
const fs = require('fs');
const html = fs.readFileSync('static/index.html', 'utf8');
const app = fs.readFileSync('static/app.js', 'utf8');
const css = fs.readFileSync('static/style.css', 'utf8');
function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exit(1); } }
assert(html.includes('role="tablist"'), 'missing role="tablist"');
assert(html.includes('aria-label="Sections"') || html.includes("aria-label='Sections'"), 'missing aria-label Sections on tablist');
assert(html.includes('data-tab="overview"'), 'missing data-tab overview');
assert(html.includes('data-tab="processes"'), 'missing data-tab processes');
assert(html.includes('data-tab="webview"'), 'missing data-tab webview');
assert(html.includes('data-tab="wsl"'), 'missing data-tab wsl');
assert(html.includes('role="tab"'), 'missing role=tab');
assert(html.includes('data-panel="overview"'), 'missing data-panel overview');
assert(html.includes('data-panel="processes"'), 'missing data-panel processes');
assert(html.includes('data-panel="webview"'), 'missing data-panel webview');
assert(html.includes('data-panel="wsl"'), 'missing data-panel wsl');
assert(html.includes('aria-sort') || app.includes('aria-sort'), 'missing aria-sort');
assert(html.includes('data-sort='), 'missing data-sort on th');
assert(app.includes('sortProcesses'), 'missing sortProcesses');
assert(app.includes('__activeTab'), 'missing window.__activeTab');
assert(app.includes('sysview-tab'), 'missing localStorage sysview-tab');
assert(css.includes('.tab-bar'), 'missing .tab-bar in css');
assert(css.includes('aria-sort') || css.includes('[aria-sort]'), 'missing th[aria-sort] style');
console.log('tabs_test: all assertions passed');
process.exit(0);
