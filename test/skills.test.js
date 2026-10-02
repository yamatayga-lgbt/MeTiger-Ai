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
];
/* 04–07 — вторая поставка навыков; их id тоже в OURS, а свои тексты проверяются в P/Q */
const GROUP2 = OURS.slice(14);
const OURS_SET = new Set(OURS);

console.log('A — реестр и перенос данных');
ok('A1: перенесены все 351 навык донора + наши ' + OURS.length,
  SKILLS.length === 351 + OURS.length && SKILLS.filter((x) => !OURS_SET.has(x.id)).length === 351,
  [SKILLS.length, SKILLS.filter((x) => !OURS_SET.has(x.id)).length].join('/'));
ok('A2: категорий 27 (25 донорских + «Решение проблем» + «Принятие решений»), и каждая непустая',
  CATS.length === 27 && ['problem', 'decision'].every((c) => CATS.some((x) => x.id === c)) && CATS.every((c) => SKILLS.some((s) => s.id !== '_' && s.cat === c.id)),
  CATS.map((c) => c.id + ':' + SKILLS.filter((s) => s.cat === c.id).length).join(' ').slice(0, 150));
ok('A3: id уникальны — иначе supersedes молча промахивается', new Set(SKILLS.map((s) => s.id)).size === SKILLS.length);
ok('A4: у каждого навыка есть текст и триггер (или always)', SKILLS.every((s) => (s.re || s.always) && String(s.text).length > 20));
ok('A5: имена инструментов переведены на наши id', (() => {
  const s = skillById('rs-web');
  return s && s.need.join() === 'web-search' && skillById('w-open').need.join() === 'url' && skillById('rand').need.join() === 'random';
})(), JSON.stringify([(skillById('rs-web') || {}).need, (skillById('w-open') || {}).need]));

console.log('B — гейт: чего в этом клиенте нет, то не обещается');
const reasons = OFF_SKILLS.map((s) => s.off);
ok('B1: выключено ровно то, что нечем выполнять (43), остальное на ходу — и наши 14 среди активных',
  OFF_SKILLS.length === 43 && ON_SKILLS.length === SKILLS.length - 43 && OURS.every((id) => !OFF_SKILLS.some((x) => x.id === id)),
  [OFF_SKILLS.length, ON_SKILLS.length, SKILLS.length].join('/'));
ok('B2: ни один выключенный навык не попал в подбор',
  ['f-pdf-read', 'img-create', 'auto-n8n', 'bypass-generic', 'neural-typing', 'w-form'].every((id) => !detect(id + ' ' + 'нужен').some((s) => s.id === id)));
ok('B3: files и editing выключены целыми категориями с объяснением',
  SKILLS.filter((s) => s.cat === 'files').every((s) => /загрузки файлов/.test(String(s.off)))
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
    GROUP2.every((id) => !get(id).off) && stats().off === 43, String(stats().off));
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
  ok('S79: OFF_CATS больше не держит editing вечно — только files',
    !('editing' in OFF_CATS) && 'files' in OFF_CATS, JSON.stringify(Object.keys(OFF_CATS)));
}

console.log(`\n${pass} пройдено, ${fail} провалено`);
process.exit(fail ? 1 : 0);
