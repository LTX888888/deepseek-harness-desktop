/**
 * Settings-document helpers for the desktop app.
 * The harness persists user settings to `$DSH_HOME/settings.yaml` and its
 * settings-file provider hot-publishes external edits (chokidar watch), so
 * writing `locale.preference` here switches the running GUI language live.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const YAML = require('yaml');

/** Resolve the harness settings document path (`$DSH_HOME` or `~/.dsh`). */
function resolveSettingsPath() {
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return path.join(dshHome, 'settings.yaml');
}

/** Read the current explicit locale preference ('zh' | 'en' | undefined). */
function readLocalePreference() {
  const settingsPath = resolveSettingsPath();
  let text;
  try {
    text = fs.readFileSync(settingsPath, 'utf8');
  } catch {
    return undefined;
  }
  if (!text.trim()) return undefined;
  try {
    const doc = YAML.parseDocument(text);
    const value = doc.getIn(['locale', 'preference']);
    return value === 'zh' || value === 'en' ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Write `locale.preference` into settings.yaml, preserving comments and
 * unrelated sections. The write is atomic (tmp + rename) so the harness
 * watcher never observes a half-written document.
 */
function writeLocalePreference(preference) {
  const settingsPath = resolveSettingsPath();
  let text = '';
  try {
    text = fs.readFileSync(settingsPath, 'utf8');
  } catch {
    /* absent file -> start empty */
  }
  let doc;
  try {
    doc = YAML.parseDocument(text.trim() ? text : '');
  } catch {
    doc = YAML.parseDocument('');
  }
  doc.setIn(['locale', 'preference'], preference);
  const output = doc.toString();

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const tmp = `${settingsPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, output, 'utf8');
  fs.renameSync(tmp, settingsPath);
}

/** Read the current skin id ('__default__' is normalized to undefined). */
function readSkinPreference() {
  const settingsPath = resolveSettingsPath();
  let text;
  try {
    text = fs.readFileSync(settingsPath, 'utf8');
  } catch {
    return undefined;
  }
  if (!text.trim()) return undefined;
  try {
    const doc = YAML.parseDocument(text);
    const value = doc.getIn(['skin', 'preference']);
    return typeof value === 'string' && value ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Write `skin.preference` into settings.yaml. Same atomic tmp+rename scheme as
 * the locale write, so the harness settings-file watcher never sees a torn file.
 */
function writeSkinPreference(preference) {
  const settingsPath = resolveSettingsPath();
  let text = '';
  try {
    text = fs.readFileSync(settingsPath, 'utf8');
  } catch {
    /* absent file -> start empty */
  }
  let doc;
  try {
    doc = YAML.parseDocument(text.trim() ? text : '');
  } catch {
    doc = YAML.parseDocument('');
  }
  doc.setIn(['skin', 'preference'], preference);
  const output = doc.toString();

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const tmp = `${settingsPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, output, 'utf8');
  fs.renameSync(tmp, settingsPath);
}

module.exports = {
  resolveSettingsPath,
  readLocalePreference,
  writeLocalePreference,
  readSkinPreference,
  writeSkinPreference,
};
