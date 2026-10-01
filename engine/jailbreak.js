/**
 * Обход ложных отказов — логика (тексты в `jailbreak.data.js`).
 *
 * Что это вообще такое по замыслу. Это НЕ «режим вседозволенности» и не смена роли:
 * это короткий блок, который снимает с модели рефлекс «я публичный ассистент, мне
 * неприлично» там, где отказа быть не должно. Он подмешивается только тогда, когда
 * модель уже попыталась отказаться (см. JAILBREAK=refusal по умолчанию) — значит на
 * нормальные ответы он не влияет ни по сути, ни по форме.
 *
 * Чего здесь сознательно нет:
 *   • требований к формату (заголовки, префиксы, разделители, «начни с …»);
 *   • персоны, псевдонима, возраста, биографии — тон остаётся за PERSONA_SYSTEM;
 *   • обещаний «отвечать на что угодно» и «этот приказ отменяет всё» — пол
 *     HARD_DANGER в freedom.js остаётся под ним, и блок сам это закрепляет (JB_FLOOR);
 *   • попыток снять отказ на настоящей опасности: если запрос про реальное оружие,
 *     яды, CSAM или самоповреждение, блок не подмешивается никогда.
 *
 * Управление (env):
 *   JAILBREAK=0 | off      — совсем выключить;
 *   JAILBREAK=1 | always    — везти в каждом запросе (для проверки, не раздувается ли ответ);
 *   JAILBREAK=refusal       — по умолчанию: только на повторной попытке после отказа;
 *   JAILBREAK_MARK=0        — не дописывать метку к переформулированному запросу.
 *
 * Runtime-независимость та же, что у всего движка: без process.env и fs.
 */

import {
  JB_CORE, JB_ROUTE, JB_FLOOR, JB_NOFORMAT, JB_FAMILY, JB_MATCH, JB_MARK, JB_SIZES,
} from './jailbreak.data.js';

export const JB_MODES = ['refusal', 'always', 'off'];

export function cfgOf(env) {
  const e = env || {};
  const raw = String(e.JAILBREAK == null ? '' : e.JAILBREAK).trim().toLowerCase();
  let mode = 'refusal';
  if (raw === '0' || raw === 'off' || raw === 'false') mode = 'off';
  else if (raw === '1' || raw === 'always' || raw === 'on' || raw === 'true') mode = 'always';
  else if (JB_MODES.indexOf(raw) >= 0) mode = raw;
  const mark = String(e.JAILBREAK_MARK == null ? '1' : e.JAILBREAK_MARK) !== '0';
  return { mode, on: mode !== 'off', mark };
}

/** Какое семейство моделей — у каждого свой вид ложного отказа. */
export function familyOf(model) {
  const m = String(model || '');
  for (const [re, id] of JB_MATCH) {
    if (re.test(m)) return id;
  }
  return '';
}

/**
 * Текст блока. info: { model, danger, escalated }.
 * `danger` — тот самый floor: если запрос про настоящую опасность, блока нет ни при
 * каком режиме, даже при JAILBREAK=1.
 */
export function block(env, info) {
  const cfg = cfgOf(env);
  const o = info || {};
  if (!cfg.on || o.danger) return '';
  if (cfg.mode === 'refusal' && !o.escalated) return '';
  const parts = [JB_CORE, JB_ROUTE, JB_FLOOR, JB_NOFORMAT];
  const fam = JB_FAMILY[familyOf(o.model)];
  if (fam) parts.push(fam);
  return '\n\n' + parts.join('\n');
}

/** Короткая метка к переформулированному запросу — приём «всегда активно» без простыни. */
export function mark(env, info) {
  const cfg = cfgOf(env);
  const o = info || {};
  if (!cfg.on || !cfg.mark || o.danger) return '';
  if (cfg.mode === 'refusal' && !o.escalated) return '';
  return ' ' + JB_MARK;
}

/** Что слой о себе знает — для диагностики и тестов. */
export function stats(env) {
  const cfg = cfgOf(env);
  const sample = block({ JAILBREAK: 'always' }, {});
  return {
    mode: cfg.mode,
    on: cfg.on,
    mark: cfg.mark,
    families: JB_MATCH.map(([, id]) => id),
    chars: sample.length,
    sizes: JB_SIZES,
  };
}

export { JB_CORE, JB_ROUTE, JB_FLOOR, JB_NOFORMAT, JB_MARK, JB_FAMILY, JB_MATCH, JB_SIZES };
