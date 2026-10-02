/**
 * Навыки (перенос механизма yama-ai/skills.js) — реестр, гейт по возможностям,
 * бюджет промпта, принудительные инструменты и блок для системного промпта.
 * Сети нет: всё проверяется на живых данных перенесённых файлов.
 * Запуск: node test/skills.test.js
 */
import {
  SKILLS, ON_SKILLS, OFF_SKILLS, CATS, detect, blockOf, toolsOf, stats, skillById,
  OFF_CATS, LIVE_CATS,
  TOOL_ALIAS, GATE,
} from '../engine/skills.js';
import { TOOL_IDS } from '../engine/tools.js';

let pass = 0; let fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (detail ? ' — ' + String(detail).slice(0, 160) : '')); }
};

/* Наши дополнения к донорскому каталогу (фазы «Логика · Планирование · Решение
   проблем»). Отдельным списком — чтобы проверка «донор перенесён целиком» не
   требовала каждый раз править число, и чтобы новые навыки нельзя было потерять
   молча: убрали навык → A1 падает. */
const OURS = [
  'r-deduction', 'r-induction', 'r-ambiguity',
  'p-constraints', 'p-alternatives', 'p-replan', 'p-blockers', 'p-done',
  'pr-define', 'pr-generate', 'pr-root', 'pr-bottleneck', 'pr-sideeffects', 'pr-prevent',
  'dc-criteria', 'dc-tradeoff', 'dc-incomplete', 'dc-sensitivity', 'dc-exit', 'dc-record',
  'd-gapchain', 'd-needsearch', 'd-strategy',
  'sr-query', 'sr-expand', 'sr-refine', 'sr-source', 'sr-internal', 'sr-period', 'sr-merge',
  'fc-primary', 'fc-date', 'fc-opinion', 'fc-scope', 'fc-links',
  'rd-thesis', 'rd-structure', 'rd-fragment', 'rd-diff', 'rd-reqs', 'rd-terms', 'rd-gaps',
  'kn-index', 'kn-dupes', 'kn-coverage', 'mc-compress', 'mc-scope',
  'da-schema', 'da-join', 'da-integrity',
  'st-groups', 'st-series', 'st-hypothesis', 'st-corr', 'st-uncert', 'st-audit',
  'pc-readcode', 'pc-types', 'pc-exceptions', 'pc-readable', 'pc-comments',
  'ar-split', 'ar-iface', 'ar-deps', 'ar-events', 'ar-distributed', 'ar-tradeoff', 'ar-docs',
  'db-message', 'db-stack', 'db-repro', 'db-minimize', 'db-locate', 'db-hypothesis', 'db-noregress',
  'ts-integration', 'ts-scenario', 'ts-boundary', 'ts-fixtures', 'ts-regression', 'ts-coverage', 'ts-bugreport',
  'dv-build', 'dv-env', 'dv-cicd', 'dv-logs', 'dv-deployfail', 'dv-config', 'dv-rollback', 'dv-release',
  'wd-http', 'wd-contract', 'wd-neterr', 'wd-pagination', 'wd-routes',
  'ds-schema', 'ds-optimize', 'ds-index', 'ds-migrate', 'ds-txn', 'ds-ref', 'ds-backup',
  'tl-syntax', 'tl-pkg', 'tl-docs', 'tl-lint', 'tl-format', 'tl-warn', 'tl-repro',
  'tx-draft', 'tx-edit', 'tx-expand', 'tx-clear', 'tx-brief',
];
/* 04–07 — вторая поставка (id 15–35, секции P и Q), 08–12 — третья (id 36–56, секция R),
   13–17 — четвёртая (id 57–90, секция T) */
const GROUP2 = OURS.slice(14, 35);
const GROUP3 = OURS.slice(35);
const OURS_SET = new Set(OURS);

console.log('A — реестр и перенос данных');
ok('A1: перенесены все 351 навык донора + наши ' + OURS.length,
  SKILLS.length === 351 + OURS.length && SKILLS.filter((x) => !OURS_SET.has(x.id)).length === 351,
  [SKILLS.length, SKILLS.filter((x) => !OURS_SET.has(x.id)).length].join('/'));
ok('A2: категорий 37 (25 донорских + problem/decision/reading/stats + arch/debug/testing/devops + webdev/dbase/tooling/writing), и каждая непустая',
  CATS.length === 37 && ['problem', 'decision', 'reading', 'stats', 'arch', 'debug', 'testing', 'devops', 'webdev', 'dbase', 'tooling', 'writing'].every((c) => CATS.some((x) => x.id === c)) && CATS.every((c) => SKILLS.some((s) => s.id !== '_' && s.cat === c.id)),
  CATS.map((c) => c.id + ':' + SKILLS.filter((s) => s.cat === c.id).length).join(' ').slice(0, 150));
ok('A3: id уникальны — иначе supersedes молча промахивается', new Set(SKILLS.map((s) => s.id)).size === SKILLS.length);
ok('A4: у каждого навыка есть текст и триггер (или always)', SKILLS.every((s) => (s.re || s.always) && String(s.text).length > 20));
ok('A5: имена инструментов переведены на наши id', (() => {
  const s = skillById('rs-web');
  return s && s.need.join() === 'web-search' && skillById('w-open').need.join() === 'url' && skillById('rand').need.join() === 'random';
})(), JSON.stringify([(skillById('rs-web') || {}).need, (skillById('w-open') || {}).need]));

console.log('B — гейт: чего в этом клиенте нет, то не обещается');
const reasons = OFF_SKILLS.map((s) => s.off);
ok('B1: выключено ровно то, что нечем выполнять (24), остальное на ходу — и наши 14 среди активных',
  OFF_SKILLS.length === 24 && ON_SKILLS.length === SKILLS.length - 24 && OURS.every((id) => !OFF_SKILLS.some((x) => x.id === id)),
  [OFF_SKILLS.length, ON_SKILLS.length, SKILLS.length].join('/'));
ok('B2: ни один выключенный навык не попал в подбор',
  ['emo-voice', 'img-create', 'auto-n8n', 'bypass-generic', 'neural-typing', 'w-form'].every((id) => !detect(id + ' ' + 'нужен').some((s) => s.id === id)));
ok('B3: files на ходу целиком (документы читает docparse), editing по-прежнему ждёт инструмент',
  SKILLS.filter((s) => s.cat === 'files').every((s) => !s.off)
  && SKILLS.filter((s) => s.cat === 'editing').every((s) => /картинок/.test(String(s.off))),
  JSON.stringify(stats().reasons).slice(0, 140));
ok('B4: ни у одного активного навыка нет ссылки на несуществующий инструмент',
  ON_SKILLS.every((s) => s.need.every((t) => TOOL_IDS().includes(t))),
  JSON.stringify(ON_SKILLS.filter((s) => s.need.some((t) => !TOOL_IDS().includes(t))).map((s) => s.id + ':' + s.need)));
ok('B5: бытовые инструменты донора вернули себе навыки (date/coin/dice/joke/image-search)',
  ['life/joke', 'life/coin', 'life/dice', 'life/rand'].map((x) => x.split('/')[1]).every((id) => !skillById(id).off)
  && !skillById('v-search').off, [skillById('v-search').off, skillById('joke').off].join('|'));
ok('B6: тексты, которые противоречили бы нашему устройству, переопределены',
  /блоками \[Инструмент:/.test(skillById('tool-use').text) && skillById('fresh').text.includes('[Инструмент: Веб-поиск]')
  && skillById('d-tools').text.includes('Инструменты этого ответа') && !/Mini App|localStorage/.test(skillById('d-limits').text),
  skillById('tool-use').text.slice(0, 60));
ok('B7: рамка честности приклеена к категории, где её нечем выполнить',
  /не запускаешь/.test(skillById('dev-write').text) && /Расписанием и фоном/.test(skillById('auto-schedule').text),
  skillById('dev-write').text.slice(-90));
ok('B8: чужих механизмов в активных текстах не осталось (кроме советов человеку)',
  !/imageSearch|imggen\b|localStorage|Mini App/i.test(ON_SKILLS.map((s) => s.text + s.title).join(' ')),
  (ON_SKILLS.find((s) => /imageSearch|imggen|localStorage|Mini App/i.test(s.text + s.title)) || {}).id);

console.log('C — подбор по смыслу');
const a = detect('сколько будет 17*23 и вообще посчитай', {});
ok('C1: арифметика тянет калькулятор как навык, а не только триггер инструмента',
  a.some((s) => s.id === 'calc') && toolsOf(a).includes('calc'), a.map((s) => s.id).join());
ok('C2: всегдашние навыки идут первыми', a[0].always && a[1].always && a.slice(2).every((s) => !s.always), a.map((s) => s.id).join());
const many = detect('переведи на английский, проверь грамматику, сделай резюме, сократи, объясни просто, найди в интернете, новости, курс доллара, погода в Минске, какой сегодня день, посчитай 5% от 200, и коротко, и подробно', {});
ok('C3: бюджет по количеству держится (не больше 16)', many.length <= 16, many.length);
ok('C4: бюджет по знакам держится — с учётом всегдашних', (() => {
  const len = (s) => s.title.length + s.text.length;
  const total = many.reduce((n, s) => n + len(s), 0);
  return total <= 3000 + many.filter((s) => s.always).reduce((n, s) => n + len(s), 0) + 320;
})(), String(many.reduce((n, s) => n + s.title.length + s.text.length, 0)));
ok('C5: supersedes работает — smalltalk вытесняется переводом',
  detect('переведи на английский', {}).every((s) => s.id !== 'smalltalk') && detect('привет', {}).some((s) => s.id === 'smalltalk'),
  detect('переведи на английский', {}).map((s) => s.id).join());
ok('C6: узкий взрослый навык не лезет в перевод, но берётся в своей теме',
  !detect('переведи на английский', {}).some((s) => s.id === 'ad-lang')
  && detect('переведи на английский вот это эротическое письмо', {}).some((s) => s.id === 'ad-lang'),
  JSON.stringify(Object.keys(GATE)));
ok('C7: картинка без слов всё равно получает зрительный навык', (() => {
  const r = detect('ууу', { images: [{ mime: 'image/png', data: 'AAA' }] });
  const v = r.find((s) => s.id === 'v-analyze');
  return !!v && v.priority === 99;
})(), 'нет v-analyze');
ok('C8: порядок — по приоритету, старший сверху', (() => {
  const pr = many.filter((s) => !s.always).map((s) => Number(s.priority) || 0);
  return pr.every((x, i) => i === 0 || pr[i - 1] >= x);
})(), many.map((s) => s.priority).join());

console.log('D — выключатели и настройки');
ok('D1: SKILLS=off — ни одного навыка, сеть не дёргается', detect('посчитай 2+2', { env: { SKILLS: 'off' } }).length === 0);
ok('D2: SKILL_MAX=2 — первые два по приоритету', detect('новости про космос и курс доллара', { env: { SKILL_MAX: '2' } }).length === 2);
ok('D3: всегдашние навыки не вытаскивают сеть на пустяк', toolsOf(detect('привет', {})).length === 0, toolsOf(detect('привет', {})).join());
const off = detect('подбрось монетку и посчитай 2+2', { env: { TOOLS_OFF: 'coin' } });
ok('D4: выключенный человеком инструмент остаётся у навыка, но с предупреждением', (() => {
  const c = off.find((s) => s.id === 'coin');
  return !!c && c.offTools.includes('coin') && !c.tools.includes('coin');
})(), JSON.stringify(off.find((s) => s.id === 'coin') || {}));

console.log('E — блок для промпта');
const blk = blockOf(detect('посчитай 2+2', {}), { toolTitles: ['Калькулятор', 'Погода'] });
ok('E1: заголовок, объяснение механизма и список — всё на месте',
  blk.startsWith('【Активные навыки') && /\[Инструмент: …\]/.test(blk) && blk.includes('【Инструменты этого ответа】Калькулятор, Погода'), blk.slice(0, 90));
ok('E2: навык с недоступным инструментом говорит об этом прямо',
  blockOf([{ id: 'x', title: 'Тест', text: 'тело', tools: [], offTools: ['news'] }], {}).includes('сейчас недоступен'));
ok('E3: пустой подбор — пустого блока нет', blockOf([], {}) === '');
const st = stats();
ok('E4: сводка сходится: on+off = всего, по категориям — те же числа',
  st.on + st.off === st.total && st.groups.reduce((n, g) => n + g.total, 0) === st.total && st.groups.reduce((n, g) => n + g.on, 0) === st.on,
  JSON.stringify([st.on, st.off, st.total]));
ok('E5: каждое донорское имя инструмента либо наше, либо в алиасах, либо отключено намеренно', (() => {
  const byDesign = new Set(['imggen', 'n8n', 'bypass']);
  const used = new Set();
  for (const s of SKILLS) for (const t of s.tools || []) used.add(t);
  const bad = [...used].filter((t) => !TOOL_IDS().includes(t) && !TOOL_ALIAS[t] && !byDesign.has(t));
  return bad.length === 0;
})(), 'непонятные имена: ' + ([...new Set(SKILLS.flatMap((s) => s.tools || []))].filter((t) => !TOOL_IDS().includes(t) && !TOOL_ALIAS[t] && !['imggen', 'n8n', 'bypass'].includes(t)).join(', ') || '-'));



console.log('P — добавленные группы: логика · планирование · решение проблем');
{
  const get = (id) => skillById(id);
  ok('P1: все 14 новых навыков в реестре, активны и с нашим заголовком',
    OURS.every((id) => get(id)) && OURS.every((id) => !get(id).off) && OURS.every((id) => /[а-яё]/.test(get(id).title)),
    OURS.filter((id) => !get(id) || get(id).off).join(','));
  ok('P2: описания короткие и внятные (витрина /api/skills читается целиком)',
    OURS.every((id) => get(id).desc.length >= 8 && get(id).desc.length <= 64) && new Set(OURS.map((id) => get(id).title)).size === OURS.length,
    OURS.map((id) => get(id).desc.length).join(','));
  ok('P3: тексты не раздувают промпт — каждый в пределах 500 знаков',
    OURS.every((id) => get(id).text.length <= 500), Math.max(...OURS.map((id) => get(id).text.length)));
  ok('P4: первая поставка (14 навыков) — правила рассуждения без инструментов (у 06–07 сеть есть, это проверяет Q4)',
    OURS.slice(0, 14).every((id) => (!get(id).tools || !get(id).tools.length) && !get(id).need.length),
    JSON.stringify(OURS.slice(0, 14).filter((id) => get(id).need.length)));
  ok('P5: «Решение проблем» — своя категория из шести навыков, в сводке видна',
    SKILLS.filter((x) => x.cat === 'problem').length === 6 && stats().groups.some((g) => g.id === 'problem' && g.on === 6),
    JSON.stringify(stats().groups.find((g) => g.id === 'problem')));
  ok('P6: supersedes новых навыков ссылается только на существующие id',
    OURS.every((id) => (get(id).supersedes || []).every((x) => !!skillById(x))),
    JSON.stringify(OURS.map((id) => get(id).supersedes).filter(Boolean)));

  const fired = (q) => detect(q, {}).map((x) => x.id);
  ok('P7: дедукция и индукция не путаются между собой',
    fired('выполни это дедуктивным выводом').includes('r-deduction') && !fired('выполни это дедуктивным выводом').includes('r-induction')
    && fired('это индуктивный вывод из наблюдений').includes('r-induction'),
    [fired('выполни это дедуктивным выводом').join(), fired('это индуктивный вывод из наблюдений').join()].join(' / '));
  const ded = get('r-deduction').text;
  ok('P8: дедукция требует назвать правило и факт и не подгонять вывод под ответ',
    /назови правило/.test(ded) && /не шире посылок/.test(ded) && /подгоняй/.test(ded), ded.slice(0, 120));
  const ind = get('r-induction').text;
  ok('P9: индукция честно помечена как правдоподобие и ищет контрпример',
    /правдоподобие, а не доказательство/.test(ind) && /границей применимости/.test(ind) && /контрпример/.test(ind), ind.slice(0, 120));
  const amb = fired('тут неоднозначно, у вопроса несколько смыслов');
  ok('P10: неоднозначность берётся на двусмысленном вопросе и молчит на ясном',
    amb.includes('r-ambiguity') && !fired('сколько будет 17*23').includes('r-ambiguity'), amb.join());
  ok('P11: и её правило не превращается в бесконечный переспрос',
    /два-три, а не десять/.test(get('r-ambiguity').text) && /один короткий уточняющий вопрос/.test(get('r-ambiguity').text)
    && /отвечай сразу/.test(get('r-ambiguity').text), get('r-ambiguity').text.slice(0, 140));
  ok('P12: «оценка уверенности в выводах» вшита в логический вывод (плюс d-confidence)',
    /хрупкое место цепочки/.test(get('r-logic').text) && !get('d-confidence').off && /опровергнет/.test(get('r-logic').text),
    get('r-logic').text.slice(-120));

  ok('P13: ограничения берутся и в рамке бюджета, и в рамке срока',
    fired('успеть нужно в рамках этого срока, бюджет не больше трёх тысяч').includes('p-constraints'), fired('успеть нужно в рамках этого срока, бюджет не больше трёх тысяч').join());
  const con = get('p-constraints').text;
  ok('P14: при несовместимости рамок навык требует сказать это прямо, а не растянуть задачу',
    /не влезает — скажи сразу|скажи сразу и дай два выхода|два выхода/.test(con) && /убрать объём или сдвинуть рамку/.test(con), con.slice(0, 180));
  ok('P15: запасной маршрут включается по «если не получится» и требует признак переключения',
    fired('а если не получится — какой у нас план Б').includes('p-alternatives') && /по какому признаку он включается/.test(get('p-alternatives').text),
    fired('а если не получится — какой у нас план Б').join());
  ok('P16: перепланирование — переписать, а не залатать (и не тащить старые обещания)',
    fired('всё пошло не по плану, надо перепланировать').includes('p-replan') && /Переписывай, а не латай/.test(get('p-replan').text)
    && /уважения к прошлому тексту/.test(get('p-replan').text), get('p-replan').text.slice(0, 160));
  ok('P17: блокирующие зависимости ищутся среди «в чужих руках» и дают параллельные работы',
    fired('какие зависимости блокируют старт проекта').includes('p-blockers') && /в чужих руках/.test(get('p-blockers').text)
    && /параллельно/.test(get('p-blockers').text), get('p-blockers').text.slice(0, 140));
  ok('P18: критерии завершения — наблюдаемые признаки, а не намерения',
    fired('по каким критериям понять, что работа готова').includes('p-done') && /наблюдаемых признаков/.test(get('p-done').text)
    && /готово от идеально/.test(get('p-done').text), get('p-done').text.slice(0, 160));

  ok('P19: формулировка проблемы требует разрыв в фактах и отделяет диагноз от решения',
    fired('не понимаю, в чём вообще проблема').includes('pr-define') && /разрыв в числах, датах или проверяемых фактах/.test(get('pr-define').text)
    && /без «всё плохо»|Без «всё плохо»/.test(get('pr-define').text), get('pr-define').text.slice(0, 160));
  ok('P20: версии собираются пачкой до отбора и формулируются ложноспрогнозируемо',
    fired('придумай версии, почему так может быть').includes('pr-generate') && /5–8/.test(get('pr-generate').text)
    && /которое может оказаться ложным/.test(get('pr-generate').text), get('pr-generate').text.slice(0, 140));
  ok('P21: первопричина — 3–5 «почему», и «виноватый человек» не считается причиной',
    fired('копни глубже, нужна первопричина, а не симптом').includes('pr-root') && /3–5 «почему»/.test(get('pr-root').text)
    && /условие на месте/.test(get('pr-root').text), get('pr-root').text.slice(0, 160));
  ok('P22: узкое место: починка мимо узла не даёт эффекта, и узел переедет',
    fired('где у нас узкое место процесса').includes('pr-bottleneck') && /Починка вне узкого места эффекта почти не даёт/.test(get('pr-bottleneck').text)
    && /переедет/.test(get('pr-bottleneck').text), get('pr-bottleneck').text.slice(0, 160));
  ok('P23: цена решения делит обратимое и необратимое и допускает «не трогать»',
    fired('какие побочные эффекты у такого решения').includes('pr-sideeffects') && /обратимое от необратимого/.test(get('pr-sideeffects').text)
    && /лучше не трогать/.test(get('pr-sideeffects').text), get('pr-sideeffects').text.slice(0, 160));
  ok('P24: предотвращение даёт три уровня и силу воли не считает решением',
    fired('что сделать, чтобы не повторилось').includes('pr-prevent') && /Три уровня/.test(get('pr-prevent').text)
    && /вместо силы воли/.test(get('pr-prevent').text) && /честно нельзя/.test(get('pr-prevent').text), get('pr-prevent').text.slice(0, 200));
  ok('P25: проверка и сравнение не продублированы — они у r-hypotheses и r-compare',
    fired('как проверить эту гипотезу').includes('r-hypotheses') && fired('сравни варианты решения и выбери').includes('r-compare')
    && !OURS.some((id) => /^(pr-verify|pr-compare)$/.test(id)),
    [fired('как проверить эту гипотезу').includes('r-hypotheses'), fired('сравни варианты решения и выбери').includes('r-compare')].join('/'));
  ok('P26: новые тексты не обещают того, чего в клиенте нет (файлы, клики, расписание, «я запущу»)',
    OURS.every((id) => !/напишу в файл|сохраню файл|кликну|открою браузер|поставлю напоминание|напомню тебе завтра|я запущу|проверю прогоном/i.test(get(id).text)),
    (OURS.find((id) => /напишу в файл|кликну|поставлю напоминание|я запущу/i.test(get(id).text)) || '-'));
  const many = detect('сформулируй проблему, найди первопричину и узкое место, оцени ограничения, собери версии, распиши этапы, приоритеты, блокировки, критерии завершения, план Б, перепланируй, оцени неоднозначность дедукцией и индукцией и цену решения, чтобы не повторилось', {});
  ok('P27: даже на «всё сразу» бюджет держится (не больше 16 и ~3000 знаков сверх всегдашних)',
    many.length <= 16 && (() => {
      const len = (x) => x.title.length + x.text.length;
      const always = many.filter((x) => x.always).reduce((n, x) => n + len(x), 0);
      return many.reduce((n, x) => n + len(x), 0) - always <= 3000;
    })(), [many.length, many.reduce((n, x) => n + x.title.length + x.text.length, 0)].join('/'));
  ok('P28: на бытовых репликах новые навыки не лезут (не раздувают промпт попусту)',
    ['привет, как дела', 'переведи на английский: good morning', 'погода в Минске', 'напиши письмо клиенту'].every((q) => !detect(q, {}).some((x) => OURS_SET.has(x.id))),
    detect('напиши письмо клиенту', {}).map((x) => x.id).join());
}


console.log('Q — добавленные группы 04–07: решения · самоконтроль · поиск · факты');
{
  const get = (id) => skillById(id);
  const fired = (q) => detect(q, {}).map((x) => x.id);
  ok('Q1: все 21 навык второй поставки в реестре и активны',
    GROUP2.every((id) => get(id) && !get(id).off), GROUP2.filter((id) => !get(id) || get(id).off).join(','));
  ok('Q2: тексты в потолке 500 знаков и заголовки не повторяются',
    GROUP2.every((id) => get(id).text.length <= 500) && new Set(GROUP2.map((id) => get(id).title)).size === GROUP2.length,
    Math.max(...GROUP2.map((id) => get(id).text.length)));
  ok('Q3: «Принятие решений» — своя категория из шести навыков, видна в сводке',
    SKILLS.filter((x) => x.cat === 'decision').length === 6 && stats().groups.some((g) => g.id === 'decision' && g.on === 6),
    JSON.stringify(stats().groups.find((g) => g.id === 'decision')));
  ok('Q4: поиск и проверка фактов зовут сеть, а правила рассуждения — нет',
    ['sr-source', 'sr-period', 'fc-primary', 'fc-date', 'fc-opinion', 'fc-scope', 'fc-links'].every((id) => get(id).need.includes('web-search'))
    && ['dc-criteria', 'dc-tradeoff', 'dc-incomplete', 'dc-sensitivity', 'dc-exit', 'dc-record', 'd-gapchain', 'd-needsearch', 'd-strategy', 'sr-query', 'sr-expand', 'sr-refine', 'sr-internal', 'sr-merge'].every((id) => !get(id).need.length),
    JSON.stringify(GROUP2.filter((id) => get(id).need.length).map((id) => id + ':' + get(id).need.join('+'))));
  ok('Q5: ни один новый навык не выключен (всё это правила, а не недоступные инструменты)',
    GROUP2.every((id) => !get(id).off) && stats().off === 24, String(stats().off));
  ok('Q6: supersedes новых навыков ссылается только на существующие id',
    GROUP2.every((id) => (get(id).supersedes || []).every((x) => !!skillById(x))),
    JSON.stringify(GROUP2.map((id) => get(id).supersedes).filter((x) => x && x.length)));

  const crit = get('dc-criteria').text;
  ok('Q7: критерии требуются до сравнения и чистятся от неизмеримого и дублей',
    fired('по каким критериям мне выбрать сервер').includes('dc-criteria') && /до сравнения зафиксируй критерии/.test(crit)
    && /неизмеримое/.test(crit) && /дубли/.test(crit), crit.slice(0, 140));
  const trade = get('dc-tradeoff').text;
  ok('Q8: компромисс показывается обменом и назван там, где он необратим',
    fired('на какой компромисс тут идём').includes('dc-tradeoff') && /за каждое преимущество — что именно отдаётся/.test(trade)
    && /необратим/.test(trade), trade.slice(0, 140));
  const inc = get('dc-incomplete').text;
  ok('Q9: при неполных данных вывод делится на три кучи и проверяется худшим случаем',
    fired('данных не хватает, но решать надо сегодня').includes('dc-incomplete') && /известно точно/.test(inc)
    && /не катастрофичен при худшем раскладе/.test(inc) && /какие два-три факта дороже всего уточнить/.test(inc), inc.slice(0, 200));
  const sens = get('dc-sensitivity').text;
  ok('Q10: чувствительность — это точка, где вывод разворачивается, а не «±1%»',
    fired('при каком значении ставки вывод меняется').includes('dc-sensitivity') && /противоположный/.test(sens)
    && /не ±1%|своим реалистичным разбросом/.test(sens), sens.slice(0, 160));
  const exit = get('dc-exit').text;
  ok('Q11: условия отказа задаются заранее, потраченное не аргумент и есть действие после',
    fired('в какой момент понять, что пора слить проект').includes('dc-exit') && /не аргумент продолжать/.test(exit)
    && /откатиться|что делать после отказа/.test(exit), exit.slice(0, 200));
  const rec = get('dc-record').text;
  ok('Q12: карточка решения фиксирует отвергнутые варианты и причину, а не переписку',
    fired('запиши решение и его обоснование').includes('dc-record') && /какие варианты отбросили и по какой причине/.test(rec)
    && /дата и кто решал/.test(rec) && /через полгода/.test(rec), rec.slice(0, 220));

  const gap = get('d-gapchain').text;
  ok('Q13: пробел в рассуждении показывается парой «посылка → вывод», а не замазывается',
    fired('где тут дыра в рассуждении').includes('d-gapchain') && /пара|парой/.test(gap)
    && /уверенным тоном/.test(gap) && /здесь пропуск/.test(gap), gap.slice(0, 220));
  const ns = get('d-needsearch').text;
  ok('Q14: нужен ли поиск — решается по свежести данных, «на всякий случай» запрещён',
    fired('надо ли искать это в интернете или ты знаешь').includes('d-needsearch') && /мог измениться после твоего обучения/.test(ns)
    && /на всякий случай/.test(ns), ns.slice(0, 200));
  const strat = get('d-strategy').text;
  ok('Q15: смена стратегии требует, чтобы новый путь отличался объяснимо',
    fired('опять не выходит, меняй подход').includes('d-strategy') && /не «ещё чуть-чуть»/.test(strat)
    && /признак, по которому увидишь/.test(strat) && /не план/.test(strat), strat.slice(0, 220));

  const q = get('sr-query').text;
  ok('Q16: постановка запроса отдаёт готовые строки, а не совет «поищи»',
    fired('как сформулировать поисковый запрос по этой теме').includes('sr-query') && /2–3 готовых варианта/.test(q)
    && /вежливые слова/.test(q), q.slice(0, 200));
  const ex = get('sr-expand').text;
  ok('Q17: расширение — 4–6 разных формулировок, шесть одинаковых не считаются',
    fired('расширь запрос синонимами').includes('sr-expand') && /4\D{0,2}6 формулиров/.test(ex) && /синоним/.test(ex) && /не считай шесть одинаковых/.test(ex), ex.slice(0, 200));
  const rf = get('sr-refine').text;
  ok('Q18: уточнение — диагноз, один ограничитель за раз, потом смена угла',
    fired('уточни запрос, не то находит').includes('sr-refine') && /сначала диагноз/.test(rf)
    && /дв[иу]х-тр[её]х итераций/.test(rf), rf.slice(0, 200));
  const src = get('sr-source').text;
  ok('Q19: поиск по источнику держится внутри него и сверяет домен, а не подменяет',
    fired('ищи только на docs.python.org').includes('sr-source') && /держи источник/.test(src)
    && /зеркало/.test(src) && /не подменяй чужой ссылкой/.test(src), src.slice(0, 220));
  const intl = get('sr-internal').text;
  ok('Q20: сначала то, что уже под рукой, и выдуманная ссылка на прошлое запрещена',
    fired('посмотри в нашей переписке, что я говорил про бюджет').includes('sr-internal') && /память разговора/.test(intl)
    && /придумать ссылку на собственное прошлое/i.test(intl), intl.slice(0, 220));
  ok('Q21: и не дублирует навык «мы обсуждали» — вытесняет его, а не ложится сверху',
    !fired('у нас это уже обсуждалось, что ты помнишь').includes('kn-user') && fired('у нас это уже обсуждалось').includes('sr-internal'),
    fired('у нас это уже обсуждалось, что ты помнишь').join(','));
  const per = get('sr-period').text;
  ok('Q22: период проверяется по дате публикации, а не по «страница лежит»',
    fired('нужны данные за 2024 год').includes('sr-period') && /дату публикации страницы/.test(per)
    && /на какой момент она верна/.test(per), per.slice(0, 220));
  const mg = get('sr-merge').text;
  ok('Q23: сведение не считает перепечатки одним пресс-релиза пятью подтверждениями',
    fired('объедини результаты трёх запросов').includes('sr-merge') && /пресс-релиза/.test(mg)
    && /усредняй молча/.test(mg) && /осталось несогласованным/.test(mg), mg.slice(0, 240));

  const prim = get('fc-primary').text;
  ok('Q24: первоисточник — документ, а не новость про документ; недоступен — сказано вслух',
    fired('дойди до первоисточника').includes('fc-primary') && /не новость про исследование/.test(prim)
    && /по пересказу/.test(prim), prim.slice(0, 220));
  const dt = get('fc-date').text;
  ok('Q25: дата публикации отделяется от «последнего обновления»',
    fired('какая дата публикации у этой статьи').includes('fc-date') && /последнее обновление/.test(dt)
    && /устаревшее не выдавай/.test(dt), dt.slice(0, 220));
  const op = get('fc-opinion').text;
  ok('Q26: мнение не оформляется как факт, а интерес источника стоит рядом с цифрой',
    fired('это факт или мнение автора').includes('fc-opinion') && /три кучи/.test(op)
    && /рядом с его цифрой/.test(op) && /«Обычно считают» фактом не становится/.test(op), op.slice(0, 240));
  const sc = get('fc-scope').text;
  ok('Q27: ограничения источника называются до вывода, а не сноской после',
    fired('какие ограничения у этой выборки').includes('fc-scope') && /до вывода, а не мелким шрифтом/.test(sc)
    && /не поднимай до «всегда»/.test(sc), sc.slice(0, 240));
  const ln = get('fc-links').text;
  ok('Q28: ссылки обязаны быть проверяемыми: [1], адрес, дата обращения, место',
    fired('дай ссылки, по которым я проверю').includes('fc-links') && /\[1\]/.test(ln)
    && /дата обращения/.test(ln) && /короткая цитата/.test(ln), ln.slice(0, 240));
  ok('Q29: и прямо запрещено выдумывать адрес, если данных из поиска нет',
    /не выдумывай адрес/.test(ln) && /главный сайт вместо страницы/.test(ln), ln.slice(-200));

  const corpus = ['привет, как дела', 'сколько будет 17*23', 'переведи на английский: good morning', 'погода в Минске',
    'напиши письмо клиенту про перенос сроков', 'посчитай 5% от 200', 'нарисуй кота в шляпе', 'что такое инфляция',
    'курс доллара', 'придумай имя для кота', 'резюме по статье', 'код не запускается, помоги', 'посоветуй фильм на вечер'];
  const mine = /^dc-|^d-(gapchain|needsearch|strategy)$|^sr-(query|expand|refine|source|internal|period|merge)$|^fc-/;
  ok('Q30: на бытовых репликах новые навыки не лезут (промпт не распухает попусту)',
    corpus.every((x) => !fired(x).some((y) => mine.test(y))),
    corpus.map((x) => x + '→' + fired(x).filter((y) => mine.test(y)).join('+')).filter((x) => x.includes('→')).join(' ; ').slice(0, 160));
  const many = detect('как сформулировать запрос, расширь его и уточни, ищи только на официальном сайте за прошлый год, сведи результаты, найди первоисточник, сверь дату и авторство, отдели факт от мнения, назови ограничения и дай ссылки, зафиксируй критерии, компромисс, чувствительность, условия отказа и запиши обоснование, проверь пробелы в рассуждении и нужен ли поиск', {});
  ok('Q31: «всё сразу» не ломает бюджет: ≤16 навыков и ≤3000 знаков сверх всегдашних',
    many.length <= 16 && (() => {
      const len = (x) => x.title.length + x.text.length;
      const always = many.filter((x) => x.always).reduce((n, x) => n + len(x), 0);
      return many.reduce((n, x) => n + len(x), 0) - always <= 3000;
    })(), [many.length, many.reduce((n, x) => n + x.title.length + x.text.length, 0)].join('/'));
  ok('Q32: в новых текстах нет обещаний того, чего в клиенте нет (файлы, клики, «я запущу»)',
    GROUP2.every((id) => !/кликну|открою браузер|сохраню в файл|напишу в файл|поставлю напоминание|я запущу|проверю прогоном/i.test(get(id).text)),
    (GROUP2.find((id) => /кликну|сохраню в файл|я запущу/i.test(get(id).text)) || '-'));
  ok('Q33: ни один новый навык не ссылается на чужие механизмы (localStorage, Mini App, imggen)',
    GROUP2.every((id) => !/localStorage|Mini App|imggen|n8n/i.test(get(id).text + get(id).title)),
    (GROUP2.find((id) => /localStorage|Mini App|imggen|n8n/i.test(get(id).text)) || '-'));

  /* Живая речь вместо канонической формулировки: навык, написанный под одну фразу,
     молчит на «чем я плачу за такую скорость». Регресс — по падежам и порядку слов. */
  const PHRASES = [
    ['dc-criteria', 'выбери по критериям, взвесь каждый'],
    ['dc-criteria', 'что для меня важнее в этом выборе — цена или срок'],
    ['dc-tradeoff', 'чем я плачу за такую скорость'],
    ['dc-tradeoff', 'какие у этого варианта издержки и что мы теряем'],
    ['dc-incomplete', 'данных кот наплакал, но выбрать надо'],
    ['dc-incomplete', 'решаем почти наугад, цифр нет'],
    ['dc-sensitivity', 'от какого числа тут всё зависит'],
    ['dc-sensitivity', 'если ставка вырастет вдвое — вывод тот же?'],
    ['dc-exit', 'в какой момент понять, что пора сливать проект'],
    ['dc-exit', 'по какому признаку выйти из сделки'],
    ['dc-record', 'обоснуй решение письменно, чтобы через год понять'],
    ['dc-record', 'зафиксируй, почему выбрали именно это'],
    ['d-gapchain', 'тут логика скачет, найди место'],
    ['d-gapchain', 'между этими строками что-то не следует'],
    ['d-needsearch', 'тебе надо это погуглить или ты и так знаешь'],
    ['d-strategy', 'три раза мимо, хватит долбить тот же путь'],
    ['sr-query', 'какие слова вбить в поиск по этой теме'],
    ['sr-expand', 'скажи то же по-другому, поиск не находит'],
    ['sr-refine', 'слишком широко, сузь выдачу годом и языком'],
    ['sr-source', 'смотри только по сайту центробанка'],
    ['sr-internal', 'мы это уже проходили?'],
    ['sr-period', 'нужно то, что вышло за последние полгода'],
    ['sr-merge', 'соедини находки из трёх запросов в одну картину'],
    ['fc-primary', 'не пересказ, дай мне сам документ'],
    ['fc-date', 'это ещё не устарело?'],
    ['fc-opinion', 'тут автор рассуждает или приводит данные'],
    ['fc-scope', 'на ком проводились эти замеры и распространимо ли это на всех'],
    ['fc-links', 'дай ссылки, чтобы я сам мог открыть и проверить'],
  ];
  const quiet = PHRASES.filter(([id, q]) => !fired(q).includes(id));
  ok('Q34: косвенные формулировки ловятся (падежи, порядок слов, синонимы)',
    quiet.length === 0, quiet.map(([id, q]) => id + '←' + q).join(' ; ').slice(0, 160));
  /* Второй глаз: чем больше слов в триггере, тем сильнее риск срабатывать на всё подряд.
     45 бытовых реплик — от «привет» до «опять тот же баг вылез». */
  const BANAL = ['привет, как дела', 'сколько будет 17*23', 'переведи на английский: до свидания', 'погода в Гомеле завтра',
    'напиши письмо клиенту про перенос сроков', 'посчитай 5% от 200', 'нарисуй кота в шляпе', 'что такое инфляция',
    'курс доллара на сегодня', 'придумай имя для щенка', 'сделай резюме этой статьи', 'код не запускается, помоги',
    'посоветуй фильм на вечер', 'поздравь Ирину с днём рождения', 'что надеть на собеседование', 'рецепт борща на двоих',
    'побольше про историю Рима', 'напиши стих про осень', 'составь список покупок', 'перепиши вежливее',
    'я не понял, объясни проще', 'не то слово, переформулируй предложение', 'проверь текст на ошибки',
    'мне нужна твоя честная оценка', 'как заработать деньги быстро', 'почему болит спина после сидения',
    'скажи, что делать, я устал думать', 'надоело всё', 'ты вообще меня слушаешь', 'это было вчера или позавчера',
    'сколько времени в Токио', 'закажи столик на семерых', 'убери повтор в списке', 'собери таблицу из этих цифр',
    'удали строки с пробелами', 'перескажи главу третьими словами', 'это моя личная информация, не сохраняй',
    'найди картинку заката', 'что нового в мире сегодня', 'давай коротко, у меня пять минут',
    'не уверен, что это сработает', 'сравни два телефона по цене', 'опять тот же баг вылез',
    'сделай красиво и чтобы было коротко', 'помни, что я вегетарианец'];
  const mine2 = /^dc-|^d-(gapchain|needsearch|strategy)$|^sr-(query|expand|refine|source|internal|period|merge)$|^fc-/;
  const noise = BANAL.filter((q) => fired(q).some((x) => mine2.test(x)));
  ok('Q35: и не цепляются за бытовые реплики (45 штук, включая «убери повтор в списке»)',
    noise.length === 0, noise.join(' ; ').slice(0, 160));
  const all = detect(PHRASES.map(([, q]) => q).join(', '), {});
  ok('Q36: даже если человек вывалил все темы сразу, в промпт идёт ограниченный набор',
    all.length <= 16 && all.reduce((n, x) => n + x.title.length + x.text.length, 0) <= 3000 +
      all.filter((x) => x.always).reduce((n, x) => n + x.title.length + x.text.length, 0),
    [all.length, all.reduce((n, x) => n + x.title.length + x.text.length, 0)].join('/'));
  ok('Q37: расширенный триггер сравнения ловит «выбираю между…», но не голое «определись»',
    fired('выбираю между двумя поставщиками, по второму почти нет цифр').includes('r-compare')
    && fired('не могу определиться, какой пакет услуг брать').includes('r-compare')
    && !fired('определись').includes('r-compare'),
    fired('выбираю между двумя поставщиками, по второму почти нет цифр').join(','));
  ok('Q38: и та же реплика тянет правило неполных данных — цифр действительно нет',
    fired('выбираю между двумя поставщиками, по второму почти нет цифр').includes('dc-incomplete')
    && fired('второй вариант дешевле, но я про него ничего не знаю').includes('dc-incomplete'),
    fired('выбираю между двумя поставщиками, по второму почти нет цифр').join(','));
}


console.log('R — добавленные группы 08–12: документы · база знаний · память · данные · статистика');
{
  const get = (id) => skillById(id);
  const fired = (q) => detect(q, {}).map((x) => x.id);
  ok('R1: все 21 навык третьей поставки в реестре и активны',
    GROUP3.every((id) => get(id) && !get(id).off), GROUP3.filter((id) => !get(id) || get(id).off).join(','));
  ok('R2: тексты в потолке 500 знаков (у навыков памяти — вместе с рамкой о том, что память это переписка чата)',
    GROUP3.every((id) => get(id).text.length <= 500) && new Set(GROUP3.map((id) => get(id).title)).size === GROUP3.length,
    Math.max(...GROUP3.map((id) => get(id).text.length)));
  ok('R3: «Чтение документов» и «Статистика и аналитика» — свои категории, 7 и 6 навыков, видны в сводке',
    SKILLS.filter((x) => x.cat === 'reading').length === 7 && SKILLS.filter((x) => x.cat === 'stats').length === 6
    && ['reading', 'stats'].every((c) => stats().groups.some((g) => g.id === c && g.on === (c === 'reading' ? 7 : 6))),
    JSON.stringify(stats().groups.filter((g) => ['reading', 'stats'].includes(g.id))));
  ok('R4: счёт идёт через calc только там, где без него «на глазок»; чтение и память — без инструментов',
    ['da-integrity', 'st-groups', 'st-series', 'st-uncert'].every((id) => get(id).need.includes('calc'))
    && ['rd-thesis', 'rd-structure', 'rd-fragment', 'rd-diff', 'rd-reqs', 'rd-terms', 'rd-gaps', 'kn-index', 'kn-dupes', 'kn-coverage', 'mc-compress', 'mc-scope', 'da-schema', 'da-join', 'st-hypothesis', 'st-corr', 'st-audit'].every((id) => !get(id).need.length),
    JSON.stringify(GROUP3.filter((id) => get(id).need.length).map((id) => id + ':' + get(id).need.join('+'))));
  ok('R5: ни один новый навык не обещает то, чего в клиенте нет (открыть файл, полистать страницы, n8n, localStorage)',
    GROUP3.every((id) => !/открою (файл|документ)|я (загрузил|открыл|листаю)|полиста[ю]|страниц[а-яё]* файла|нажму|localStorage|Mini App|n8n|imggen/i.test(get(id).text + get(id).title)),
    GROUP3.filter((id) => /открою файл|полистаю|localStorage/i.test(get(id).text)).join(','));
  ok('R6: чтение честно про обрезанный текст: навыки документов говорят об этом, а не делают вид',
    /обрывок|обрезан|не прислан|пришёл текст без|разметки нет/.test(get('rd-gaps').text + get('rd-structure').text + get('rd-diff').text)
    && /страниц[а-яё]* (не выдумывай|и номеров строк не выдумывай)/.test(get('rd-fragment').text), '—');

  /* Роспись 40 пунктов: каждая формулировка обязана тянуть нужный навык — новый или тот,
     которым пункт закрыт. Это и есть проверка, что пункт не «закрыт» только на бумаге. */
  const POINTS = [
    ['rd-thesis', 'вытащи из этой статьи ключевые тезисы'], ['rd-thesis', 'о чём этот документ, по пунктам'],
    ['rd-structure', 'опиши структуру документа'], ['rd-structure', 'какие разделы в этом протоколе и зачем'],
    ['summary', 'сократи этот текст до половины'],
    ['rd-fragment', 'найди в договоре пункт про неустойку'], ['rd-fragment', 'где там написано про сроки поставки — дословно'],
    ['rd-diff', 'сравни две редакции договора'], ['rd-diff', 'чем вторая версия отличается от первой'],
    ['rd-reqs', 'выпиши все требования из ТЗ'], ['rd-reqs', 'какие обязательства содержит этот договор'],
    ['rd-terms', 'какие термины здесь определены'], ['rd-terms', 'собери глоссарий документа'],
    ['rd-gaps', 'что не указано в этом акте'], ['rd-gaps', 'какие поля в форме остались пустыми'],
    ['kn-base', 'что у тебя в базе знаний про этот проект'],
    ['kn-index', 'как проиндексировать эти документы для поиска'],
    ['kn-classify', 'разложи знания по категориям'],
    ['kn-link', 'свяжи эти материалы между собой'],
    ['kn-update', 'как обновлять записи, когда правила меняются'],
    ['kn-dupes', 'в базе куча повторяющихся записей'],
    ['kn-stale', 'какие записи в базе уже устарели'],
    ['kn-coverage', 'насколько полная наша база знаний'],
    ['mem-relevance', 'возьми из истории только то, что относится к этому вопросу'],
    ['mc-compress', 'сожми историю разговора, контекст кончается'],
    ['mem-project', 'запиши решение по проекту, чтобы не потерять'],
    ['kn-extract', 'отдели то, что известно, от того, что кажется'],
    ['mc-scope', 'это только на эту задачу, не запоминай навсегда'],
    ['mem-project', 'на чём мы остановились, верни состояние задачи'],
    ['mem-conflict', 'у тебя в записях противоречие'],
    ['kn-stale', 'проверь, не устарело ли то, что ты помнишь'],
    ['da-schema', 'опиши схему этой таблицы'],
    ['data-clean', 'почисти данные перед анализом'],
    ['data-process', 'приведи значения к одному виду'],
    ['data-missing', 'где в данных пропуски'],
    ['data-dedup', 'найди дубликаты в выгрузке'],
    ['da-join', 'объедини две таблицы по общему ключу'],
    ['formats', 'сконвертируй csv в json'],
    ['da-integrity', 'проверь, сходятся ли суммы в отчёте'],
    ['data-stats', 'посчитай среднее, медиану и разброс'],
    ['st-groups', 'сравни две группы и скажи, значимо ли'],
    ['data-stats', 'как выглядит распределение этих значений'],
    ['st-series', 'разбери динамику по месяцам'],
    ['st-hypothesis', 'проверь статистическую гипотезу'],
    ['st-corr', 'есть ли корреляция между ценой и спросом'],
    ['st-uncert', 'оцени с погрешностью'],
    ['st-audit', 'перепроверь аналитический вывод'],
  ];
  const silent = POINTS.filter(([id, q]) => !fired(q).includes(id));
  ok('R7: все 40 пунктов сняты живыми формулировками (' + POINTS.length + ' фраз)',
    silent.length === 0, silent.map(([id, q]) => id + '←' + q).join(' ; ').slice(0, 170));

  const BANAL = ['привет', 'как дела', 'сколько будет 7*8', 'переведи: good night', 'погода', 'напиши поздравление',
    'что посмотреть в выходные', 'посоветуй ноутбук', 'спасибо, ты молодец', 'почему кошки мурлычут',
    'сделай кофе-машину короче', 'удали мои данные', 'это секрет, никому не говори', 'сколько дней до Нового года',
    'напиши мне стишок про Гомель', 'не могу уснуть', 'купить билеты на поезд', 'объясни как ребёнку',
    'этот файл не открывается', 'напиши в чат позже', 'что ты вообще умеешь', 'давай поговорим', 'сравни цены на бензин',
    'поругайся', 'доброе утро', 'я устал', 'расскажи анекдот', 'что надеть', 'перескажи коротко', 'помоги с резюме',
    'расскажи, что тут по делу происходит', 'это шум или нет, мне всё равно', 'насколько верить этому человеку',
    'разбери, чем всё сшит', 'у нас три причины для радости', 'что значит пустое место в этой анкете',
    'как разложить книги на полке, чтобы искалось', 'у нас с тобой всё хорошо', 'полнота моих чувств',
    'сократи её', 'история болезни', 'разговор в баре',
    'контекст встречи', 'сегодня плохая погода', 'позвони маме вечером',
    'запиши меня к врачу', 'сколько стоит билет до Минска', 'объясни ребёнку, что такое инфляция',
    'перечисли продукты для ужина', 'что ответить начальнику', 'напиши письмо-извинение',
    'разберись в моих мыслях', 'это важно или нет', 'давай просто поговорим',
    'что посмотреть вечером', 'как дела с ремонтом', 'сделай покороче и повеселее',
    'не нравится мне этот тон', 'объясни проще', 'что почитать на выходные',
    'посчитай чаевые с 2400', 'утомили отчёты', 'сегодня суббота, идём гулять',
    'мне грустно', 'измени пароль от почты', 'поздравь Петрова с днём рождения',
    'я вернулся к задаче потом'];
  /* Рамка — все наши 56 навыков, не только группа 08–12: бытовой вопрос не имеет права
     притянуть «проверку целостности» или «сжатие контекста». */
  const noise = BANAL.filter((q) => fired(q).some((x) => OURS_SET.has(x)));
  ok('R8: и молчат на бытовом корпусе (' + BANAL.length + ' фраз, включая «этот файл не открывается»)',
    noise.length === 0, noise.join(' ; ').slice(0, 170));
  const many = detect(POINTS.map(([, q]) => q).join(', '), {});
  const len = (x) => x.title.length + x.text.length;
  ok('R9: «всё сразу» влезает в бюджет: ≤16 навыков и ≤3000 знаков сверх всегдашних',
    many.length <= 16 && many.reduce((n, x) => n + len(x), 0) - many.filter((x) => x.always).reduce((n, x) => n + len(x), 0) <= 3000,
    [many.length, many.reduce((n, x) => n + len(x), 0)].join('/'));

  const must = (id, res, label) => ok(label, res.every((re) => re.test(get(id).text)), get(id).text.slice(0, 150));
  must('rd-thesis', [/утверждение, а не тема/, /не подгоняй под три/], 'R10: тезис — утверждение, а не тема; количество не подгоняется');
  must('rd-structure', [/разметки нет/, /не выдумывай номера страниц/], 'R11: структура: без разметки это сказано вслух, страницы не выдумываются');
  must('rd-fragment', [/символ в символ/, /не выдумывай/, /не дословный ответ/], 'R12: фрагмент дословно, место — только то, что есть в тексте');
  must('rd-diff', [/добавлено, удалено, переформулировано/, /косметическими/, /сравнивать не с чем/], 'R13: версии: три списка, косметика помечена, без второй версии — стоп');
  must('rd-reqs', [/по одному на строку/, /отдельно от желательного/, /заявлено, но не обеспечено/], 'R14: требования: обязательное отделено от желательного, «заявлено» помечено');
  must('rd-terms', [/что определено в документе/, /расходится с обычным/, /в документе не определено/], 'R15: термины значат то, что определено, а не то, к чему привыкли');
  must('rd-gaps', [/не додумывай|Пропущенное из «обычно так пишут» не додумывай/, /целый ли текст|обрывок/], 'R16: пропуски: ничего не додумывается, обрывок замечается первым');
  must('kn-index', [/по смыслу, а не по 500 строк|режь куски по смыслу/, /заголовок родителя/, /по словам человека/], 'R17: индекс: куски по смыслу, метаданные, проверка живым запросом');
  must('kn-dupes', [/показай все|покажи все/, /свеж[а-яё]* дата|свежее дата/, /это два факта/, /не усреднять/], 'R18: дубликаты: копии показываются, основная — свежайшая, похожее ≠ дубль');
  must('kn-coverage', [/вопросами, ради которых/, /частично/, /по одному своему обзору не объявляют|по одному своему обзору/], 'R19: полнота меряется вопросами, а не числом записей');
  must('mc-compress', [/решения и почему|решения и почему именно так/, /«выброшено»/, /имена, числа и даты в исходном виде/], 'R20: сжатие держит решения и цифры, выброшенное помечено');
  must('mc-scope', [/подтвержд[а-яё]+ правил|подтверждённое правило/, /за её пределами/, /всплывает месяцами/], 'R21: временное не становится постоянным без подтверждения');
  must('da-schema', [/пустое значение/, /по содержимому, а не по заголовк/, /угадайка/], 'R22: схема: тип по данным, пустое значение объяснено');
  must('da-join', [/типы/, /было N и M|Отчитайся цифрами/, /выбор, а не техника|выбор, а не техник/], 'R23: склейка: типы ключа, отчёт о потерях, выбор соединения объяснён');
  must('da-integrity', [/через calc/, /Подгонять цифру/, /расхождени[а-яё]* назови числом|Расхождение назови числом/], 'R24: целостность считается, а не подгоняется');
  must('st-groups', [/сопоставимост/, /размер каждой/, /вывод на шуме|держится на шуме/], 'R25: сравнение групп: размер, разброс, сопоставимость, порог «это шум»');
  must('st-series', [/непрерывность/, /сезонност/, /интервалом/, /на пяти точках/], 'R26: ряд: непрерывность и сезонность, прогноз интервалом');
  must('st-hypothesis', [/пороге и кто его выбрал/, /не считываются|локально не считаются/, /значимо.*не значит|не значит «важно»|«Значимо» не значит «важно»/], 'R27: гипотезы: порог назван, p-value не выдумывается, значимость ≠ важность');
  must('st-corr', [/на скольких наблюдениях/, /минимум два объяснения/, /причинный вывод|причинно/], 'R28: корреляция: объём наблюдений и альтернативные объяснения обязательны');
  must('st-uncert', [/разброс|погрешность/, /порядка 8–12%|порядка 8/, /не выбирай середину|вместо «10,3%»|а не ставь|не значит/i], 'R29: неопределённость: диапазон вместо голой точки');
  must('st-audit', [/знаменател/, /баз[а-яё]* сравнения|базу сравнения|база сравнения/, /подгонять|Подгонять/], 'R30: вывод сверяется со знаменателем и базой, подгонка запрещена');

  ok('R31: расширение донорских триггеров не сломало соседей',
    fired('сократи этот текст до половины').includes('summary')
    && fired('почисти данные перед анализом').includes('data-clean')
    && fired('приведи значения к одному виду').includes('data-process')
    && fired('разложи знания по категориям').includes('kn-classify')
    && fired('выбираю между двумя поставщиками').includes('r-compare')
    && fired('посчитай среднее, медиану и разброс').includes('data-stats'),
    POINTS.length + ' формулировок сверено');
  /* Развязка `files` — не «включить всё подряд»: у каждого включённого навыка есть механизм
     (docparse на вход, filegen на исход). Проверка держит границу: чего нет, то и дальше off. */
  ok('R32: и развязка files не открыла то, чем нечем выполнять (11 editing, клики, n8n, голос — всё ещё off)',
    ['img-create', 'w-form', 'auto-n8n', 'emo-voice'].every((id) => skillById(id).off) && stats().off === 24,
    'off ' + stats().off);
  ok('R33: новые навыки не ссылаются на чужие механизмы и не обещают хранлище',
    GROUP3.every((id) => !/localStorage|IndexedDB|Mini App|webhook|сохраню в базу|занесу в каталог/i.test(get(id).text)),
    GROUP3.filter((id) => /localStorage|сохраню в базу/i.test(get(id).text)).join(',') || '-');
  ok('R34: счётные навыки помнят, что p-value и мощность локально не считаются',
    /не считаются|не считываются|не моя арифметика|локально не/.test(get('st-hypothesis').text)
    && /calc/.test(get('st-hypothesis').text), get('st-hypothesis').text.slice(0, 200));
  ok('R35: ни один новый навык не выключен и бюджет выключенных не вырос (43)',
    GROUP3.every((id) => !get(id).off) && stats().off === 24, String(stats().off));

  /* Косвенные формулировки — то, на чём триггеры обычно и ломаются: падежи, порядок
     слов, глагол не тот. Каноническая фраза ничего не доказывает. */
  const INDIRECT = [
    ['rd-structure', 'разбери, чем этот отчёт сшит'],
    ['rd-thesis', 'что тут по делу, без воды'],
    ['rd-fragment', 'как именно там сформулировано про форс-мажор'],
    ['rd-diff', 'посмотри, что поменяли во второй редакции'],
    ['rd-reqs', 'что от нас требует этот регламент'],
    ['rd-terms', 'что автор понимает под термином «субъект»'],
    ['rd-gaps', 'тут что-то забыли дописать, найди'],
    ['kn-index', 'как разложить папку инструкций, чтобы поиск работал'],
    ['kn-dupes', 'у нас три записи про одно и то же'],
    ['kn-coverage', 'всё ли мы задокументировали по этому модулю'],
    ['mc-compress', 'история разговора распухла, сократи её'],
    ['mc-scope', 'запомни это только на сегодняшнюю задачу'],
    ['da-schema', 'что за колонки в этой выгрузке и что значит пустое место'],
    ['da-join', 'подтяни клиентов из второй таблицы в первую'],
    ['da-integrity', 'ведомость и выгрузка не бьются между собой'],
    ['st-groups', 'различия между выборками — это шум или нет'],
    ['st-groups', 'отличаются ли группы между собой'],
    ['st-series', 'в марте провал, потом рост: что с рядом'],
    ['st-hypothesis', 'достаточно ли данных, чтобы отвергнуть нулевую'],
    ['st-corr', 'не путаешь ли ты корреляцию с причиной'],
    ['st-uncert', 'насколько можно верить этой цифре'],
    ['st-audit', 'не задним числом ли подогнан вывод под цифры'],
  ];
  const deaf = INDIRECT.filter(([id, q]) => !fired(q).includes(id));
  ok('R36: и косвенные формулировки слышны (' + INDIRECT.length + ' фраз, включая «чем этот отчёт сшит»)',
    deaf.length === 0, deaf.map(([id, q]) => id + '←' + q).join(' ; ').slice(0, 170));
  ok('R37: и не цепляют то, что похоже, но не про это (регресс расширенных триггеров)',
    !fired('это шум или нет, мне всё равно').includes('st-groups')
    && !fired('насколько верить этому человеку').includes('st-uncert')
    && !fired('как разложить книги на полке, чтобы искалось').includes('kn-index')
    && !fired('история болезни').includes('mc-compress')
    && !fired('у нас с тобой всё хорошо').includes('kn-dupes'),
    ['это шум или нет, мне всё равно', 'насколько верить этому человеку', 'как разложить книги на полке, чтобы искалось',
     'история болезни', 'у нас с тобой всё хорошо'].map((q) => q + '→' + (fired(q).join('+') || '—')).join(' ; ').slice(0, 170));

  /* Текст навыка тоже договор: если в нём не сказано «числа в сообщении — уже данные»,
     модель переспрашивает про файл, даже когда всё посчитать можно на месте. */
  ok('R38: da-integrity не отправляет человека за файлом, когда числа уже в сообщении',
    /Числа в сообщении — уже данные/.test(get('da-integrity').text), String(get('da-integrity').text.length));
  ok('R39: и укладывается в потолок 500 знаков после сборки фрейма',
    GROUP3.every((id) => get(id).text.length <= 500),
    GROUP3.map((id) => id + ':' + get(id).text.length).filter((x) => +x.split(':')[1] > 500).join(' ') || 'макс ' + Math.max(...GROUP3.map((id) => get(id).text.length)));

  /* Категория `files` развязана только потому, что читатель документов свой. Проверки ниже
     держат обе стороны: навыки на ходу, и тексты переписаны под то, что разборщик реально отдаёт. */
  const FILES_REWRITTEN = {
    'f-pdf-read': /стр. 12|номера страниц|выдумывай/,
    'f-txt': /около чего она/,
    'f-find': /страницу он не размечает/,
    'f-structure': /прочитался ли он вообще/,
    'f-edit': /на месте не перезаписывается/,
  };
  const fl = SKILLS.filter((s) => s.cat === 'files');
  ok('R40: все 19 навыков files на ходу — не благодаря заглушке, а потому что есть docparse и filegen',
    fl.length === 19 && fl.every((s) => !s.off), String(fl.filter((s) => s.off).length));
  ok('R41: и их формулировки обещают только то, что наш разбор видит (страниц, нумерации строк и правки исходника нет)',
    Object.entries(FILES_REWRITTEN).every(([id, re]) => re.test(get(id).text)),
    JSON.stringify(Object.keys(FILES_REWRITTEN).filter((id) => !FILES_REWRITTEN[id].test(get(id).text))));
  ok('R42: на бытовом корпусе skills-навыки молчат так же, как наши',
    BANAL.filter((q) => fired(q).some((x) => /^f-|^image-file$|^doc-analysis$/.test(x))).length === 0,
    BANAL.filter((q) => fired(q).some((x) => /^f-|^image-file$|^doc-analysis$/.test(x))).join(' ; ').slice(0, 170));

  /* Развязанная категория бесполезна, если её не слышно: у донора «проанализируй
     приложенный файл» разбивался о требуемую смежность слов. */
  ok('R43: «проанализируй приложенный файл» тянет doc-analysis, а «проанализируй мой отзыв о фильме» — нет',
    fired('проанализируй приложенный файл').includes('doc-analysis')
    && !fired('проанализируй мой отзыв о фильме').includes('doc-analysis')
    && !fired('скажи, это хороший файл или нет').includes('doc-analysis'),
    fired('проанализируй приложенный файл').join('+'));
}

/* ═══════════ живые категории (LIVE_CATS): картинки ═══════════ */
console.log('S7 — категория оживает сама, когда инструмент отвечает');
{
  const editing = SKILLS.filter((x) => x.cat === 'editing');
  ok('S71: в категории editing есть навыки, и все они живые (live=imggen)',
    editing.length >= 8 && editing.every((x) => x.live === 'imggen'), String(editing.length));
  ok('S72: без готового инструмента они выключены с причиной про источник',
    editing.every((x) => /источник картинок/.test(x.off || '')), editing[0].off);
  const ask = 'убери фон с картинки и верни всё как было';
  const dead = detect(ask, { env: {} });
  const live = detect(ask, { env: {}, imgToolReady: { imggen: true } });
  ok('S73: на просьбу правки навык включается только когда imggen жив',
    !dead.some((x) => x.cat === 'editing') && live.some((x) => x.cat === 'editing'),
    JSON.stringify({ dead: dead.map((x) => x.id), live: live.map((x) => x.id) }));
  ok('S74: и тянет за собой инструмент картинок (а без готовности — не тянет)',
    toolsOf(live).indexOf('imggen') >= 0 && toolsOf(dead).indexOf('imggen') < 0,
    toolsOf(live).join() + ' / ' + toolsOf(dead).join());
  ok('S75: текст ожившего навыка доезжает до промпта', blockOf(live, {}).length > blockOf(dead, {}).length,
    [blockOf(dead, {}).length, blockOf(live, {}).length].join('→'));
  const st = stats({ imgToolReady: { imggen: true } });
  const st0 = stats();
  ok('S76: сводка это показывает: on растёт ровно на размер категории',
    st.on - st0.on === editing.length, [st0.on, st.on, editing.length].join('/'));
  ok('S77: и в live-разделе написано, чем именно категория оживает',
    st0.live.length === 1 && st0.live[0].tool === 'imggen' && st0.live[0].ready === false, JSON.stringify(st0.live));
  ok('S78: когда инструмент жив, причины «нечем выполнять» в сводке не остаётся',
    st.reasons.join(' ').indexOf('источник картинок') < 0, st.reasons.join(' '));
  ok('S79: OFF_CATS пуста — ни editing, ни files не глушатся навсегда (files развязана в 0.021)',
    !('editing' in OFF_CATS) && !('files' in OFF_CATS), JSON.stringify(Object.keys(OFF_CATS)));
}


/* ═══════════ группы 13–17: программирование · архитектура · отладка · тесты · инфраструктура ═══════════ */
console.log('T — добавленные группы 13–17: пять заказов по восемь пунктов');
{
  const get = (id) => skillById(id);
  const fired = (q) => detect(q, {}).map((x) => x.id);
  const NEW_RE = /^(pc|ar|db|ts|dv)-/;
  const ours = SKILLS.filter((x) => NEW_RE.test(x.id));
  ok('T1: 34 навыка на месте, четыре новые категории завелись (arch, debug, testing, devops)',
    ours.length === 34 && ['coding', 'arch', 'debug', 'testing', 'devops'].every((c) => SKILLS.some((x) => x.cat === c)),
    String(ours.length));
  /* Ловушка, в которую легко влететь: ключ называется prompt. Написать text — и навык
     «работает», неся вместо методики desc в 25 знаков. */
  ok('T2: у каждого текст длиннее 120 знаков — то есть это prompt, а не подмена desc',
    ours.every((x) => x.text.length > 120),
    ours.map((x) => [x.id, x.text.length]).filter(([, n]) => n <= 120).join(' '));
  ok('T3: потолок 500 знаков соблюдён у всех 34 (с рамкой категории)', ours.every((x) => x.text.length <= 500),
    String(Math.max(...ours.map((x) => x.text.length))));
  ok('T4: отладка и тесты несут рамку «код не запускаешь» — иначе обещают прогон, которого нет',
    ['db-repro', 'db-locate', 'ts-integration', 'ts-boundary', 'ts-regression'].every((id) => /не запускаешь/.test(get(id).text)),
    ['db-repro', 'ts-integration'].filter((id) => !/не запускаешь/.test(get(id).text)).join(','));
  ok('T5: DevOps несёт рамку «инфраструктурой не управляешь» — иначе обещает задеплоить и откатить',
    ['dv-cicd', 'dv-deployfail', 'dv-release'].every((id) => /не управляешь/.test(get(id).text)),
    ['dv-cicd', 'dv-release'].filter((id) => !/не управляешь/.test(get(id).text)).join(','));

  /* По фразе на каждый из 40 пунктов заказа (где пункт закрыт донором — ожидается донор),
     плюс вторые формулировки там, где пункт звучит по-разному. Провал здесь означает
     «пункт заказа не слышно». */
  const GROUPS = [
    ['напиши функцию, которая парсит csv', 'dev-write'],
    ['напиши код, который читает csv и считает суммы', 'dev-write'],
    ['как этот код вообще работает', 'pc-readcode'],
    ['не могу понять чужой код', 'pc-readcode'],
    ['разберись с типами данных', 'pc-types'],
    ['приведи типы к общему виду', 'pc-types'],
    ['не лови все исключения подряд', 'pc-exceptions'],
    ['ошибки глотаются молча', 'pc-exceptions'],
    ['код тяжело читать, дай имена', 'pc-readable'],
    ['сделай читаемо, без магии', 'pc-readable'],
    ['прокомментируй этот блок', 'pc-comments'],
    ['подготовь технические комментарии', 'pc-comments'],
    ['как разбить систему на модули', 'ar-split'],
    ['спроектируй интерфейс этого модуля', 'ar-iface'],
    ['разорви цикл зависимостей', 'ar-deps'],
    ['управляй зависимостями между пакетами', 'ar-deps'],
    ['как организовать события между сервисами', 'ar-events'],
    ['сколько реплик и где источник истины', 'ar-distributed'],
    ['сравни монолит и микросервисы, чем заплатим', 'ar-tradeoff'],
    ['нарисуй схему архитектуры', 'dev-architecture'],
    ['задокументируй архитектурные решения', 'ar-docs'],
    ['что значит это сообщение об ошибке', 'db-message'],
    ['расшифруй трейс', 'db-message'],
    ['разбери стек вызовов', 'db-stack'],
    ['не могу воспроизвести баг', 'db-repro'],
    ['сократи пример до минимума', 'db-minimize'],
    ['где именно ломается', 'db-locate'],
    ['проверь гипотезу про кэш', 'db-hypothesis'],
    ['исправь опечатку в функции', 'dev-fix'],
    ['почини этот код', 'dev-fix'],
    ['не сломало ли правка соседей', 'db-noregress'],
    ['напиши интеграционный тест', 'ts-integration'],
    ['проверь сценарием как у пользователя', 'ts-scenario'],
    ['протестируй границы значений', 'ts-boundary'],
    ['сгенерируй тестовые данные', 'ts-fixtures'],
    ['проверь регрессию после фикса', 'ts-regression'],
    ['покрытие падает', 'ts-coverage'],
    ['какие модули не покрыты вовсе', 'ts-coverage'],
    ['оформи баг-репорт', 'ts-bugreport'],
    ['сборка падает на ci', 'dv-build'],
    ['сборка стала слишком долгой', 'dv-build'],
    ['настрой ci на каждый пул-реквест', 'dv-cicd'],
    ['разбери эти логи', 'dv-logs'],
    ['после выкладки всё упало', 'dv-deployfail'],
    ['фича-флаг пора убирать', 'dv-config'],
    ['план отката если релиз поедет', 'dv-rollback'],
    ['готов ли релиз к выпуску', 'dv-release'],
    ['настрой окружение под проект', 'dv-env'],
  ];
  const deaf = GROUPS.filter(([q, id]) => !fired(q).includes(id));
  ok('T6: все ' + GROUPS.length + ' эталонных фраз тянут ожидаемый навык', deaf.length === 0,
    deaf.map(([q, id]) => q + ' ≠' + id + ' → ' + fired(q).join(',')).slice(0, 3).join(' ;; '));
  ok('T6b: в корпусе 48 фраз — по числу пунктов плюс двойники', GROUPS.length === 48, String(GROUPS.length));

  ok('T7: донор тестов расширен — «напиши тесты на эту функцию» и «добавь юнит-тесты» его',
    fired('напиши тесты на эту функцию').includes('dev-tests') && fired('добавь юнит-тесты').includes('dev-tests'),
    fired('добавь юнит-тесты').join(','));
  ok('T8: донор архитектуры расширен — выбор стиля живёт у него, а не только у ar-tradeoff',
    fired('монолит или микросервисы').includes('dev-architecture')
    && fired('выбери архитектуру для нового сервиса').includes('dev-architecture'), fired('монолит или микросервисы').join(','));
  ok('T9: владения разведены — покрытие и моки больше не у dev-tests, комментарии не у dev-docs',
    !fired('покрытие падает').includes('dev-tests') && !fired('сделай мок платёжного шлюза').includes('dev-tests')
    && fired('прокомментируй этот блок').includes('pc-comments') && !fired('прокомментируй этот блок').includes('dev-docs'),
    [fired('покрытие падает').join(','), fired('прокомментируй этот блок').join(',')].join(' // '));
  ok('T10: dev-write больше не обещает прогон run_js — такого инструмента в реестре нет',
    !SKILLS.some((x) => /run_js/.test(x.text)) && /прогони глазами/.test(get('dev-write').text), get('dev-write').text.slice(0, 70));

  const MUNDANE = ['погода в Гомеле завтра', 'переведи на английский: good morning', 'сколько будет 15% от 240',
    'поздравь коллегу с днём рождения', 'что посмотреть в выходные', 'соли и перца по вкусу', 'запланируй поездку',
    'напиши письмо клиенту', 'объясни, что такое инфляция', 'как почистить кроссовки', 'сколько варить яйца всмятку',
    'доклад в школу про вулкан', 'как поднять пульс', 'скажи прогноз по курсу', 'что посмотреть на море',
    'сколько калорий в рисе', 'перескажи сериал', 'как часто менять полотенце', 'сочини тост',
    'заболело горло, что делать', 'тест на прочность стекла', 'границы широты', 'пограничник на заставе',
    'поделка из теста', 'выкладка плитки в ванной', 'конфигурация компьютера для игр', 'обзор сборки пк',
    'логарифм числа 100', 'закрой вкладку браузера', 'не открывается приложение на телефоне', 'тест на беременность',
    'отчёт по практике', 'план питания на неделю', 'откат стиральной машины к заводским настройкам',
    'заказ билдов на сборку мебели', 'сделай читаемо это стихотворение', 'ошибки в тексте, поправь',
    'тест на беременность показал две полоски', 'как построить карьеру', 'разбери сонник про воду'];
  const spilled = MUNDANE.filter((q) => fired(q).some((x) => NEW_RE.test(x)));
  ok('T11: ' + MUNDANE.length + ' бытовых фраз, похожих по корням, не тянут новые технические навыки',
    spilled.length === 0,
    spilled.slice(0, 4).map((q) => q + ' → ' + fired(q).filter((x) => NEW_RE.test(x)).join(',')).join(' ;; '));
  const flood = fired(GROUPS.map((x) => x[0]).join(' и '));
  ok('T12: все 48 фраз разом — в бюджет (≤16) и без текста сверх потолка',
    flood.length <= 16 && flood.every((id) => !NEW_RE.test(id) || get(id).text.length <= 500), String(flood.length));

  /* Категория 18+ жила короткими корнями и открывалась в спокойном разговоре: «дебаг» (еба),
     «соскочить» (соск), «Иванович» (вич), «ты теперь». Проверка на месте, чтобы это
     не вернулось при следующем переносе донора. */
  const ADULT = SKILLS.filter((x) => x.cat === 'adult').map((x) => x.id);
  const CLEAN = ['дебаг этого модуля', 'хлеба и воды', 'взгляни в небо', 'как соскочить с поезда',
    'Иванович, помоги с отчётом', 'спидометр врёт', 'у меня фантазии нет на это', 'ты теперь мой основной собеседник',
    'мне нужна ласка кота', 'бляха на куртке', 'сделай диалог между двумя сервисами', 'от его лица в логах',
    'напиши код для парсера', 'границы широты', 'исправь ошибку в коде', 'небо над головой'];
  const dirty = CLEAN.filter((q) => detect(q, {}).some((x) => ADULT.includes(x.id)));
  ok('T13: бытовые фразы не открывают категорию 18+ (навыков в ней ' + ADULT.length + ')',
    dirty.length === 0 && ADULT.length >= 12,
    dirty.slice(0, 4).map((q) => q + ' → ' + detect(q, {}).filter((x) => ADULT.includes(x)).join(',')).join(' ;; '));
  const REAL = ['напиши матом', 'перескажи нецензурно', 'эротический рассказ', 'флирт с девушкой',
    'смени пол персонажа', 'интимные фантазии про нас', 'секс-советы для взрослых', 'оцени моё фото'];
  ok('T14: а настоящие обращения в 18+ по-прежнему слышны',
    REAL.every((q) => detect(q, {}).some((x) => ADULT.includes(x.id))),
    REAL.filter((q) => !detect(q, {}).some((x) => ADULT.includes(x))).join(' ;; '));

  const st1 = stats();
  ok('T15: сводка выросла на наши 58 — 407 → 465 (13–17 и 18–21), выключенных не прибавилось',
    st1.total === 465 && st1.on === 441 && st1.off === 24 && st1.groups.length === 37, [st1.total, st1.on, st1.off, st1.groups.length].join('/'));
  ok('T16: у новых навыков нет ни off, ни live-гейта (инструменты им не нужны)',
    ours.every((x) => !x.off && !x.live), ours.filter((x) => x.off || x.live).map((x) => x.id).join(','));
}


/* ═══════════ группы 18–21: веб-разработка · базы данных · инструменты · создание текстов ═══════════
   Здесь опаснее всего не отсутствие навыка, а два навыка на одну фразу: пункты 18.1, 18.2, 18.4,
   19.2, 20.3, 21.3, 21.4 и 21.6 закрыты донорами, и в корпусе ожидаются именно они. */
console.log('U — добавленные группы 18–21: четыре заказа по восемь пунктов');
{
  const get = (id) => skillById(id);
  const fired = (q) => detect(q, {}).map((x) => x.id);
  const NEW_RE = /^(wd|ds|tl|tx)-/;
  const ours = SKILLS.filter((x) => NEW_RE.test(x.id));
  ok('U1: 24 навыка на месте, четыре новые категории завелись (webdev, dbase, tooling, writing)',
    ours.length === 24 && ['webdev', 'dbase', 'tooling', 'writing'].every((c) => SKILLS.some((x) => x.cat === c)),
    String(ours.length));
  /* Ловушка та же, что и в T2: ключ называется prompt; text — и навык несёт desc. */
  ok('U2: у каждого текст длиннее 120 знаков — то есть это методика, а не подмена описания',
    ours.every((x) => x.text.length > 120),
    ours.map((x) => [x.id, x.text.length]).filter(([, n]) => n <= 120).join(' '));
  ok('U3: потолок 500 знаков соблюдён у всех 24 — вместе с рамкой категории',
    ours.every((x) => x.text.length <= 500), String(Math.max(...ours.map((x) => x.text.length))));
  ok('U4: webdev, dbase и tooling несут рамку честности, writing — без рамки (ему обещать нечего)',
    /не отправляешь/.test(get('wd-http').text) && /Доступа к базе/.test(get('ds-txn').text)
    && /не выполняешь/.test(get('tl-lint').text) && !/не отправляешь|Доступа к базе|не выполняешь/.test(get('tx-draft').text),
    ['wd-http', 'ds-txn', 'tl-lint', 'tx-draft'].map((id) => id + ':' + get(id).text.length).join(' '));
  ok('U5: ни один новый навык не требует инструмента — need пустой, врать про прогон нечем',
    ours.every((x) => !x.need || x.need.length === 0), ours.filter((x) => x.need && x.need.length).map((x) => x.id).join(','));

  /* По две формулировки на пункт заказа; там, где пункт закрыт донором, ожидается донор.
     Провал здесь означает «пункт заказа не слышно». */
  const GROUPS = [
    ["спроектируй rest api для каталога", "dev-api-design"],
    ["чем get отличается от post", "wd-http"],
    ["что значит 422 и 409", "wd-http"],
    ["идемпотентность запроса", "wd-http"],
    ["подключи api погодов к сервису", "dev-rest"],
    ["сделай запрос к api и разбери ответ", "dev-rest"],
    ["сверь ответ с openapi", "wd-contract"],
    ["это breaking change для клиентов", "wd-contract"],
    ["запрос отваливается по таймауту, как ретраить", "wd-neterr"],
    ["429 и retry-after, что делать", "wd-neterr"],
    ["как сделать пагинацию в api", "wd-pagination"],
    ["на тысячной странице выгрузка падает", "wd-pagination"],
    ["как назвать эндпоинты для мобильного клиента", "wd-routes"],
    ["спроектируй маршруты api", "wd-routes"],
    ["спроектируй схему базы для заказов", "ds-schema"],
    ["нужна ли денормализация", "ds-schema"],
    ["напиши sql для отчёта по месяцам", "dev-sql"],
    ["запрос тормозит, разбери", "ds-optimize"],
    ["последовательное сканирование вместо индекса", "ds-optimize"],
    ["какой индекс добавить к этой таблице", "ds-index"],
    ["порядок колонок в индексном ключе", "ds-index"],
    ["как добавить not null без даунтайма", "ds-migrate"],
    ["миграция блокирует таблицу", "ds-migrate"],
    ["как не держать транзакцию открытой во время сетевого запроса", "ds-txn"],
    ["deadlock между двумя службами", "ds-txn"],
    ["уровень изоляции для списания денег", "ds-txn"],
    ["в таблице завелись сироты", "ds-ref"],
    ["каскад удалит лишнее", "ds-ref"],
    ["как восстановить базу на прошлые сутки", "ds-backup"],
    ["сколько данных потеряем при откате", "ds-backup"],
    ["парсер падает на этой строке, что не так", "tl-syntax"],
    ["unexpected token, где искать", "tl-syntax"],
    ["пакет не устанавливается, что делать", "tl-pkg"],
    ["зачем нужен lock-файл", "tl-pkg"],
    ["управляй зависимостями пакетов", "ar-deps"],
    ["как читать документацию библиотеки", "tl-docs"],
    ["доки не соответствуют версии", "tl-docs"],
    ["как настроить eslint", "tl-lint"],
    ["отключить правило линтера?", "tl-lint"],
    ["prettier переписывает весь файл", "tl-format"],
    ["форматтер и редактор ссорятся", "tl-format"],
    ["что значат предупреждения компилятора", "tl-warn"],
    ["стоит ли игнорировать warning", "tl-warn"],
    ["собери минимальный воспроизводимый проект", "tl-repro"],
    ["оформи баг отдельным репозиторием", "tl-repro"],
    ["набросай черновик статьи", "tx-draft"],
    ["с чего начать писать текст", "tx-draft"],
    ["отредактируй мой текст", "tx-edit"],
    ["убери канцелярит из письма", "tx-edit"],
    ["переформулируй абзац", "c-paraphrase"],
    ["скажи иначе про логистику", "c-paraphrase"],
    ["сократи текст до трёх предложений", "summary"],
    ["расширь объяснение про кэш", "tx-expand"],
    ["добавь пример в этот абзац", "tx-expand"],
    ["сделай тон деловым", "tone"],
    ["напиши это мягче", "c-tone"],
    ["проверь ясность этого абзаца", "tx-clear"],
    ["читатель не поймёт, где спотыкается", "tx-clear"],
    ["соответствует ли текст заданию", "tx-brief"],
    ["сверь пост с брифом", "tx-brief"],
    ];
  const deaf = GROUPS.filter(([q, id]) => !fired(q).includes(id));
  ok('U6: все ' + GROUPS.length + ' эталонных фраз тянут ожидаемый навык', deaf.length === 0,
    deaf.map(([q, id]) => q + ' ≠' + id + ' → ' + fired(q).join(',')).slice(0, 3).join(' ;; '));
  ok('U6b: корпус покрывает все 32 пункта — по две формулировки плюс донорские углы', GROUPS.length === 60, String(GROUPS.length));

  ok('U7: доноры развязаны — dev-sql больше не кричит на индексы и миграции, tone и ar-deps подобрали новые формулировки',
    !fired('какой индекс добавить к этой таблице').includes('dev-sql')
    && !fired('как правильно мигрировать базу').includes('dev-sql')
    && fired('сделай тон деловым').includes('tone') && fired('управляй зависимостями пакетов').includes('ar-deps'),
    [fired('какой индекс добавить к этой таблице').join(','), fired('сделай тон деловым').join(',')].join(' // '));
  ok('U7b: спор владений снят — «сделай текст живее» и «черновик тоста» не у наших tx-навыков',
    !fired('сделай текст живее для соцсетей').includes('tx-edit')
    && !fired('черновик тоста').includes('tx-draft') && !fired('каскад из бусин').includes('ds-ref')
    && !fired('транзакция с квартирой').includes('ds-txn') && !fired('поправь мой текст').includes('tx-edit'),
    ['сделай текст живее для соцсетей', 'черновик тоста', 'каскад из бусин'].map((q) => q + '→' + fired(q).filter((x) => NEW_RE.test(x)).join(',')).join(' '));
  /* Опасное место: у вёрстки тоже есть пагинация. Голый корень «пагинац» в триггере поднимал
     навык API на фразу про список на странице — проверка не даёт этому вернуться. */
  ok('U7c: пагинация вёрстки не уходит к wd-pagination — ему нужен api-контекст',
    !fired('сделай пагинацию в списке на странице').includes('wd-pagination')
    && fired('как сделать пагинацию в api').includes('wd-pagination')
    && fired('на тысячной странице выгрузка падает').includes('wd-pagination'),
    fired('сделай пагинацию в списке на странице').join(','));
  ok('U8: auto-api остался сценарным углом — пагинацию и ретраи он не обещает',
    /ключ|расписан|отказ/i.test(get('auto-api').text) && get('auto-api').desc.indexOf('пагинация') < 0,
    get('auto-api').desc);
  ok('U9: p-constraints жив — цифра в условии читается (старый триггер с \\d был мёртв)',
    fired('собери презентацию, бюджет не больше 5000 рублей').includes('p-constraints'),
    fired('собери презентацию, бюджет не больше 5000 рублей').join(','));

  /* Бытовой корпус: навыки построены на словах «запрос», «тон», «индекс», «миграция»,
     «черновик», «пакет» — они обязаны молчать там, где про них только слово. */
  const MUNDANE = [
    "погода в Гомеле",
    "переведи на английский: good morning",
    "сколько будет 18*24",
    "поздравь с днём рождения",
    "что посмотреть в выходные",
    "соли и перца по вкусу",
    "запланируй маршрут на выходные",
    "напиши письмо клиенту",
    "объясни, что такое инфляция",
    "как почистить кроссовки",
    "сколько варить яйца",
    "доклад в школу про вулкан",
    "как часто менять полотенце",
    "сочини тост",
    "заболело горло",
    "перескажи сериал",
    "сколько калорий в рисе",
    "тест на беременность",
    "границы широты",
    "выкладка плитки в ванной",
    "конфигурация компьютера для игр",
    "обзор сборки пк",
    "логарифм числа 100",
    "закрой вкладку браузера",
    "план питания на неделю",
    "откат дивана в состояние «до ремонта»",
    "сборка мангала из кирпича",
    "прогноз курса",
    "напиши поздравление коллеге",
    "сделай текст живее для соцсетей",
    "сократи меня до трёх слов",
    "какой индекс купить на бирже",
    "база отдыха на озере",
    "запрос в администрацию",
    "миграция птиц",
    "транзакция с квартирой",
    "черновик тоста",
    "набросок плана поездки",
    "расширение ассортимента в магазине",
    "почистить диск от фото",
    "лишние пакеты для рассады",
    "проверить договор на ясность",
    "документация на стиральную машину",
    "пакет документов для визы",
    "бухгалтерская база 1с",
    "уровень доверия в отношениях",
    "сироты в романе",
    "каскад из бусин",
    "журнал расходов семьи",
    ];
  const spilled = MUNDANE.filter((q) => fired(q).some((x) => NEW_RE.test(x)));
  ok('U10: ' + MUNDANE.length + ' бытовых фраз с теми же корнями не тянут новые навыки',
    spilled.length === 0,
    spilled.slice(0, 4).map((q) => q + ' → ' + fired(q).filter((x) => NEW_RE.test(x)).join(',')).join(' ;; '));
  const flood = fired(GROUPS.map((x) => x[0]).join(' и '));
  ok('U11: все 60 фраз разом — в бюджет (≤16), и ни один новый текст не вырос сверх потолка',
    flood.length <= 16 && flood.every((id) => !NEW_RE.test(id) || get(id).text.length <= 500), String(flood.length));
  ok('U12: все 24 id зафиксированы в OURS — иначе A1 перестанет считать их нашими',
    OURS.slice(90).length === 24 && OURS.slice(90).every((id) => get(id)), String(OURS.length));
}

console.log(`\n${pass} пройдено, ${fail} провалено`);
process.exit(fail ? 1 : 0);
