/**
 * Assays: serves your private IFU library to the Assays page, and keeps your pins and notes in step.
 *
 *   Library    : My Drive / 00_Apps / Assays / assays-library.json   (key numbers and page text, read only)
 *   IFU PDFs   : My Drive / OneDrive Import / 1. Lab / Admin / IFU / Abbott Alinity   (top level only; _Archive is ignored)
 *   Your data  : My Drive / 00_Apps / Assays / assays-sync.json       (pins and notes)
 *   Backups    : My Drive / 00_Apps / Assays / backups /               (rolling, newest 40 kept)
 *
 * One-time setup
 *   1. Run "setup" once (Run button). Allow access when Google asks.
 *   2. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 *   3. Run "setupLink" and open the link it logs in Brave on each PC.
 *
 * The script answers only requests that carry your key. The key lives in this script's
 * properties, never in the public Assays page. It sends a PDF only if that PDF sits in the
 * IFU folder above, and it fetches nothing from the web except the public SGH test index.
 */
var APP = 'assays-sync', VERSION = 1;
var FOLDERS = ['00_Apps', 'Assays'];
var IFU_PATH = ['OneDrive Import', '1. Lab', 'Admin', 'IFU', 'Abbott Alinity'];
var DATA_FILE = 'assays-sync.json';
var LIBRARY_FILE = 'assays-library.json';
var SGH_FILE = 'sgh-index.json';
var SGH_INDEX = 'https://www.sgh.com.sg/content/singhealth-web/sgh/en/our-specialties/pathology/pathology-lab-services.pathologyAutoSuggestion.json?pathologyMicroSiteRootPath=%2Fcontent%2Fsinghealth-web%2Fsgh%2Fen%2Four-specialties%2Fpathology%2Fpathology-lab-services';
var SGH_PUBLIC = 'https://www.sgh.com.sg/our-specialties/pathology/pathology-lab-services';
var SGH_DAYS = 7;
var BACKUP_FOLDER = 'backups';
var KEEP_BACKUPS = 40;
var AUTO_BACKUP_HOURS = 20;
var MAX_PDF_BYTES = 30 * 1024 * 1024;

function setup() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('SYNC_KEY');
  if (!key) {
    key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('SYNC_KEY', key);
  }
  var file = dataFile_();
  backupFolder_();
  var ifu = ifuFolder_();
  Logger.log('Assays is ready.');
  Logger.log('Your data: ' + file.getUrl());
  Logger.log('Library: ' + (libraryFile_() ? 'found' : 'not found yet - put ' + LIBRARY_FILE + ' in 00_Apps/Assays'));
  Logger.log('IFU folder: ' + (ifu ? ifu.getUrl() + ' (' + listPdfs_(ifu).length + ' PDFs)' : 'not found - set the IFU_FOLDER_ID script property'));
  Logger.log('Next: Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone), then run setupLink.');
}

/* Logs the one-click link that connects a browser to this script. Treat it like a password. */
function setupLink() {
  var key = PropertiesService.getScriptProperties().getProperty('SYNC_KEY');
  var url = ScriptApp.getService().getUrl();
  if (!key) { Logger.log('Run setup first.'); return; }
  if (!url) { Logger.log('Deploy as a Web app first (Deploy > New deployment).'); return; }
  var hash = Utilities.base64EncodeWebSafe(JSON.stringify({ u: url, k: key })).replace(/=+$/, '');
  Logger.log('https://3dfung-ai.github.io/assays/#sync=' + hash);
}

/* Run this only if a setup link was shared by mistake. Every browser then needs the new link. */
function newKey() {
  PropertiesService.getScriptProperties().deleteProperty('SYNC_KEY');
  setup();
}

function doGet() {
  return json_({ ok: true, app: APP, v: VERSION, note: 'Assays is running. Use this link inside Assays.' });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad_json' }); }
  var key = PropertiesService.getScriptProperties().getProperty('SYNC_KEY');
  if (!key || !req || typeof req.key !== 'string' || req.key !== key) return json_({ ok: false, error: 'bad_key' });
  if (req.op === 'ping') return json_({ ok: true, app: APP, v: VERSION });
  try {
    // Read-only requests need no lock.
    if (req.op === 'library') return json_(library_(req));
    if (req.op === 'pdf') return json_(pdf_(req));
    if (req.op === 'sgh') return json_(sgh_(req));
  } catch (err) {
    if (err && err.code) return json_({ ok: false, error: err.code });
    return json_({ ok: false, error: 'server', detail: String((err && err.message) || err).slice(0, 300) });
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return json_({ ok: false, error: 'busy' });
  try {
    if (req.op === 'sync') return json_(sync_(req));
    if (req.op === 'info') return json_(info_());
    if (req.op === 'backups') return json_(listBackups_());
    if (req.op === 'restore') return json_(restore_(req));
    return json_({ ok: false, error: 'bad_op' });
  } catch (err) {
    if (err && err.code) return json_({ ok: false, error: err.code });
    return json_({ ok: false, error: 'server', detail: String((err && err.message) || err).slice(0, 300) });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- library and PDFs ---------- */
function library_(req) {
  var lib = libraryFile_();
  var ifu = ifuFolder_();
  var out = { ok: true, files: ifu ? listPdfs_(ifu) : [], folderUrl: ifu ? ifu.getUrl() : '', folderFound: !!ifu };
  if (!lib) { out.library = null; out.missing = true; return out; }
  var raw = lib.getBlob().getDataAsString();
  var m = /"version":"([^"]+)"/.exec(raw.slice(0, 2000)) || /"version":"([^"]+)"/.exec(raw);
  var version = m ? m[1] : String(lib.getLastUpdated().getTime());
  out.version = version;
  out.libraryUpdated = lib.getLastUpdated().toISOString();
  if (req.have && req.have === version) { out.same = true; return out; }
  try { out.library = JSON.parse(raw); } catch (err) { throw { code: 'corrupt_library' }; }
  return out;
}

function pdf_(req) {
  var ifu = ifuFolder_();
  if (!ifu) throw { code: 'no_ifu_folder' };
  var f;
  try { f = DriveApp.getFileById(String(req.fileId || '')); } catch (err) { throw { code: 'not_found' }; }
  if (!inFolder_(f, ifu) || !/\.pdf$/i.test(f.getName())) throw { code: 'not_an_ifu' };
  if (f.getSize() > MAX_PDF_BYTES) throw { code: 'too_big' };
  return { ok: true, id: f.getId(), name: f.getName(), modified: f.getLastUpdated().toISOString(), size: f.getSize(),
    b64: Utilities.base64Encode(f.getBlob().getBytes()) };
}

function listPdfs_(folder) {
  var out = [], it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (!/\.pdf$/i.test(f.getName())) continue;
    out.push({ id: f.getId(), name: f.getName(), size: f.getSize(), modified: f.getLastUpdated().toISOString() });
  }
  out.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
  return out;
}

function inFolder_(file, folder) {
  var parents = file.getParents();
  while (parents.hasNext()) { if (parents.next().getId() === folder.getId()) return true; }
  return false;
}

function ifuFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('IFU_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (err) { props.deleteProperty('IFU_FOLDER_ID'); } }
  var folder = DriveApp.getRootFolder();
  for (var i = 0; i < IFU_PATH.length; i++) {
    var it = folder.getFoldersByName(IFU_PATH[i]);
    if (!it.hasNext()) return null;
    folder = it.next();
  }
  props.setProperty('IFU_FOLDER_ID', folder.getId());
  return folder;
}

function libraryFile_() {
  var it = appFolder_().getFilesByName(LIBRARY_FILE);
  return it.hasNext() ? it.next() : null;
}

/* ---------- SGH test directory: names and links only, refreshed weekly ---------- */
function sgh_(req) {
  var folder = appFolder_();
  var it = folder.getFilesByName(SGH_FILE), file = it.hasNext() ? it.next() : null, cached = null;
  if (file) { try { cached = JSON.parse(file.getBlob().getDataAsString()); } catch (err) { cached = null; } }
  var fresh = cached && cached.fetched && Date.now() - Date.parse(cached.fetched) < SGH_DAYS * 86400000;
  if (fresh && !req.force) return { ok: true, sgh: cached, cached: true };
  try {
    var res = UrlFetchApp.fetch(SGH_INDEX, { muteHttpExceptions: true, followRedirects: true, headers: { Accept: 'application/json' } });
    if (res.getResponseCode() !== 200) throw new Error('HTTP ' + res.getResponseCode());
    var payload = JSON.parse(res.getContentText());
    var tests = [], seen = {};
    (payload.result || []).forEach(function (item) {
      var path = String((item && item.path) || '').replace(/\.html$/, '').replace(/\/$/, '');
      path = path.replace(/^\/content\/singhealth-web\/sgh\/en/, '');
      if (path.indexOf('/our-specialties/pathology/pathology-lab-services/') !== 0) return;
      var name = String(item.testName || item.searchMatchesCriteria || '').replace(/\s+/g, ' ').trim();
      if (!name || seen[path]) return;
      seen[path] = true;
      tests.push({ n: name, u: 'https://www.sgh.com.sg' + path, c: String(item.category || '').trim(), s: String(item.searchMatchesCriteria || '').replace(/\s+/g, ' ').trim().slice(0, 300) });
    });
    if (!tests.length) throw new Error('empty index');
    var data = { fetched: new Date().toISOString(), catalogue: SGH_PUBLIC, tests: tests };
    if (file) file.setContent(JSON.stringify(data)); else folder.createFile(SGH_FILE, JSON.stringify(data), 'application/json');
    return { ok: true, sgh: data, cached: false };
  } catch (err) {
    if (cached) return { ok: true, sgh: cached, cached: true, stale: true };
    return { ok: false, error: 'sgh_unavailable', detail: String((err && err.message) || err).slice(0, 200), catalogue: SGH_PUBLIC };
  }
}

/* ---------- sync of pins and notes ---------- */
function sync_(req) {
  var file = dataFile_();
  var store = readStore_(file);
  var recs = store.records;
  var now = Date.now();
  var device = String(req.device || '').slice(0, 60);
  var changes = Array.isArray(req.changes) ? req.changes : [];
  var accepted = [], conflicts = [], apply = [], done = {};

  for (var i = 0; i < changes.length; i++) {
    var ch = changes[i];
    if (!ch || typeof ch.id !== 'string' || !ch.id || ch.id.length > 200 || done[ch.id]) continue;
    done[ch.id] = true;
    if (!ch.purge && (!ch.data || typeof ch.data !== 'object' || ch.data.id !== ch.id)) continue;
    var cur = recs[ch.id];
    var base = ch.baseRev === undefined ? null : ch.baseRev;
    if (cur && cur.rev !== base && !(cur.purged && ch.purge)) {
      conflicts.push({ id: ch.id, rev: cur.rev, purged: !!cur.purged, device: cur.device || '', data: cur.purged ? null : cur.data });
      continue;
    }
    if (!cur && ch.purge) { accepted.push({ id: ch.id, rev: null }); continue; }
    apply.push(ch);
  }

  if (apply.length) {
    var due = !store.lastBackupAt || now - store.lastBackupAt > AUTO_BACKUP_HOURS * 3600 * 1000;
    if ((req.backup || due) && Object.keys(recs).length) {
      backup_(file, typeof req.backup === 'string' ? req.backup : 'daily');
      store.lastBackupAt = now;
    }
    for (var j = 0; j < apply.length; j++) {
      var c = apply[j];
      store.rev += 1;
      recs[c.id] = { rev: store.rev, updated: now, device: device, purged: !!c.purge, data: c.purge ? null : c.data };
      accepted.push({ id: c.id, rev: store.rev });
    }
    store.savedAt = new Date(now).toISOString();
    store.savedBy = device;
    file.setContent(JSON.stringify(store));
  }

  var have = req.have && typeof req.have === 'object' ? req.have : {};
  var skip = {};
  accepted.forEach(function (a) { skip[a.id] = true; });
  conflicts.forEach(function (c) { skip[c.id] = true; });
  var updates = [];
  Object.keys(recs).forEach(function (id) {
    var r = recs[id];
    if (skip[id] || have[id] === r.rev) return;
    if (r.purged && have[id] === undefined) return;
    updates.push({ id: id, rev: r.rev, purged: !!r.purged, device: r.device || '', data: r.purged ? null : r.data });
  });
  return {
    ok: true, accepted: accepted, conflicts: conflicts, updates: updates,
    serverRev: store.rev, count: liveCount_(recs), savedAt: store.savedAt || null, savedBy: store.savedBy || '',
    lastBackupAt: store.lastBackupAt || null,
  };
}

function info_() {
  var file = dataFile_();
  var store = readStore_(file);
  var lib = libraryFile_();
  return { ok: true, app: APP, v: VERSION, fileUrl: file.getUrl(), count: liveCount_(store.records), serverRev: store.rev,
    savedAt: store.savedAt || null, savedBy: store.savedBy || '', lastBackupAt: store.lastBackupAt || null,
    libraryUpdated: lib ? lib.getLastUpdated().toISOString() : null };
}

/* Number of assays with a pin or a note. */
function liveCount_(recs) {
  var n = 0;
  Object.keys(recs).forEach(function (id) {
    var r = recs[id];
    if (!r.purged && r.data && (r.data.pin || r.data.note)) n++;
  });
  return n;
}

/* ---------- backups ---------- */
function backup_(file, label) {
  var folder = backupFolder_();
  var stamp = new Date().toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, 'Z');
  var tag = label ? '_' + String(label).replace(/[^A-Za-z0-9-]/g, '').slice(0, 30) : '';
  folder.createFile('assays-sync_' + stamp + tag + '.json', file.getBlob().getDataAsString(), 'application/json');
  prune_(folder);
}

function backupFiles_(folder) {
  var files = [], it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (/^assays-sync_.*\.json$/.test(f.getName())) files.push(f);
  }
  files.sort(function (a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
  return files;
}

function prune_(folder) {
  backupFiles_(folder).slice(KEEP_BACKUPS).forEach(function (f) { f.setTrashed(true); });
}

function listBackups_() {
  var files = backupFiles_(backupFolder_());
  return { ok: true, backups: files.map(function (f) {
    return { id: f.getId(), name: f.getName(), size: f.getSize(), created: f.getDateCreated().toISOString() };
  }) };
}

function restore_(req) {
  var folder = backupFolder_();
  var f;
  try { f = DriveApp.getFileById(String(req.fileId || '')); } catch (err) { return { ok: false, error: 'not_found' }; }
  if (!inFolder_(f, folder) || !/^assays-sync_.*\.json$/.test(f.getName())) return { ok: false, error: 'not_a_backup' };
  var snap;
  try { snap = JSON.parse(f.getBlob().getDataAsString()); } catch (err) { return { ok: false, error: 'corrupt_backup' }; }
  var srecs = (snap && snap.records) || {};
  var file = dataFile_();
  var store;
  try { store = readStore_(file); } catch (err) {
    store = emptyStore_();
    store.rev = Math.max(Number(snap && snap.rev) || 0, Date.now());
  }
  backup_(file, 'before-restore');
  var now = Date.now(), restored = 0, trashed = 0;
  Object.keys(srecs).forEach(function (id) {
    var b = srecs[id];
    if (!b || b.purged || !b.data) return;
    var cur = store.records[id];
    if (cur && !cur.purged && JSON.stringify(cur.data) === JSON.stringify(b.data)) return;
    store.rev += 1;
    store.records[id] = { rev: store.rev, updated: now, device: 'restore', purged: false, data: b.data };
    restored++;
  });
  Object.keys(store.records).forEach(function (id) {
    var cur = store.records[id];
    if (cur.purged || !cur.data) return;
    var b = srecs[id];
    if (b && !b.purged && b.data) return;
    store.rev += 1;
    store.records[id] = { rev: store.rev, updated: now, device: 'restore', purged: true, data: null };
    trashed++;
  });
  store.lastBackupAt = now;
  store.savedAt = new Date(now).toISOString();
  store.savedBy = 'restore';
  file.setContent(JSON.stringify(store));
  return { ok: true, restored: restored, trashed: trashed, serverRev: store.rev, from: f.getName() };
}

/* ---------- storage ---------- */
function emptyStore_() { return { app: APP, schema: 1, rev: 0, records: {} }; }

function readStore_(file) {
  var raw = file.getBlob().getDataAsString();
  if (!raw || !raw.trim()) return emptyStore_();
  var s;
  try { s = JSON.parse(raw); } catch (err) { throw { code: 'corrupt_store' }; }
  if (!s || typeof s !== 'object' || (s.records && typeof s.records !== 'object')) throw { code: 'corrupt_store' };
  s.records = s.records || {};
  s.rev = s.rev || 0;
  s.app = APP; s.schema = 1;
  return s;
}

function appFolder_() {
  var folder = DriveApp.getRootFolder();
  FOLDERS.forEach(function (name) {
    var it = folder.getFoldersByName(name);
    folder = it.hasNext() ? it.next() : folder.createFolder(name);
  });
  return folder;
}

function dataFile_() {
  var folder = appFolder_();
  var it = folder.getFilesByName(DATA_FILE);
  if (it.hasNext()) return it.next();
  return folder.createFile(DATA_FILE, JSON.stringify(emptyStore_()), 'application/json');
}

function backupFolder_() {
  var parent = appFolder_();
  var it = parent.getFoldersByName(BACKUP_FOLDER);
  return it.hasNext() ? it.next() : parent.createFolder(BACKUP_FOLDER);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
