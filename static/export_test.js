// static/export_test.js — H1T5 contract: redact true strips secret
const {buildExportPayload} = require('./app.js');
const env={capturedAt:"2026-09-01T00:00:00Z",schemaVersion:1,providers:{memory:"ok"},errors:[],data:{Memory:{VisiblePhysicalBytes:1},WebViewProcesses:[{PID:123,CommandLine:"token=secret --webview-exe-name=Teams.exe",Path:"C:\\app.exe"}],AllProcesses:[{PID:123,Path:"C:\\Users\\Alice\\secret.exe"}]}};

// redact true => secret stripped from WebViewProcesses, path handling preserves but not leak secret in CommandLine
const out=buildExportPayload(env,{redact:true});
const json = JSON.stringify(out);
if(json.includes("secret") && !json.includes("C:\\Users\\Alice\\secret.exe")){
  // second check: if AllProcesses path contains secret.exe that's path — plan says keep path, so allow but CommandLine secret must be gone
}
if(json.includes("token=secret")){
  console.error("FAIL: redacted payload still contains secret token");
  process.exit(1);
}
if(!out.WebViewProcesses && !out.data){
  console.error("FAIL: unexpected shape");
  process.exit(1);
}
// check WebViewProcesses redacted
const wv = (out.data ? out.data.WebViewProcesses : out.WebViewProcesses) || [];
if(wv[0] && wv[0].CommandLine !== "[redacted]"){
  console.error("FAIL: WebViewProcesses CommandLine not redacted:", wv[0].CommandLine);
  process.exit(1);
}
// redact false => secret preserved
const out2=buildExportPayload(env,{redact:false});
if(!JSON.stringify(out2).includes("secret")){
  console.error("FAIL: redact false should preserve secret");
  process.exit(1);
}
// exportedAt and exportNote present
if(!out.exportedAt || !out.exportNote){
  console.error("FAIL: missing exportedAt/exportNote");
  process.exit(1);
}
if(isNaN(Date.parse(out.exportedAt))){
  console.error("FAIL: exportedAt not ISO");
  process.exit(1);
}
// JSON valid
try{ JSON.parse(JSON.stringify(out)); }catch(e){ console.error("FAIL: JSON invalid"); process.exit(1); }
// clone immutability: original not mutated
if(env.data.WebViewProcesses[0].CommandLine !== "token=secret --webview-exe-name=Teams.exe"){
  console.error("FAIL: original mutated");
  process.exit(1);
}
console.log("export_test PASS");
