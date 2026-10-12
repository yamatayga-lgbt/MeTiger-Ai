/**
 * Общий страж согласия версий (0.170).
 *
 * Проверок «все источники версии синхронизированы» набралось восемь — по одной в
 * ui161…ui169, и каждая сверяла по-своему, в том числе формат VERSION.md. Когда
 * формат сменили с заголовка «# Version 0.170» на простую строку «0.170», починили
 * одну проверку и уронили следующую: Deploy 0.170 не прошёл именно на этом.
 *
 * Теперь проверка ровно одна, и она терпима к форме записи — важен факт «VERSION.md
 * знает эту версию», а не то, как её оформили. Что остаётся строгим: форма номера
 * (три цифры после точки), согласие version.ts, package.json и package-lock.json.
 */
import { readFileSync } from 'node:fs';

/** Читает все источники версии разом. */
export function readVersions() {
  const versionSrc = readFileSync('src/lib/version.ts', 'utf8');
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const vmd = readFileSync('VERSION.md', 'utf8');
  const current = versionSrc.match(/APP_VERSION = '([^']+)'/)?.[1];
  return { current, pkg, lock, vmd };
}

/** Форма номера: 0.170 — три цифры после точки. */
export function isVersionShape(v) {
  return /^0\.\d{3}$/.test(String(v || ''));
}

/** VERSION.md знает эту версию: заголовком «# Version X» или просто строкой «X». */
export function vmdHas(vmd, v) {
  const esc = String(v || '').replace('.', '\\.');
  const text = String(vmd || '');
  return new RegExp('#\\s*Version\\s+' + esc).test(text)
    || new RegExp('^\\s*' + esc + '\\s*$', 'm').test(text);
}

/**
 * Все источники говорят одно и то же.
 * @returns {{ ok: boolean, current?: string, why: string }}
 */
export function versionsAligned() {
  try {
    const { current, pkg, lock, vmd } = readVersions();
    const lockTop = lock && lock.packages && lock.packages[''] ? lock.packages[''].version : current;
    const ok = Boolean(current && isVersionShape(current)
      && pkg.version === current
      && lock.version === current
      && lockTop === current
      && vmdHas(vmd, current));
    return { ok, current, why: [current, pkg.version, lock.version, lockTop].join('/') };
  } catch (e) {
    return { ok: false, why: String((e && e.message) || e) };
  }
}
