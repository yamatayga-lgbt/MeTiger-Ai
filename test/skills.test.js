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
];
const OURS_SET = new Set(OURS);

console.log('A — реестр и перенос данных');
ok('A1: перенесены все 351 навык донора + наши ' + OURS.length,
  SKILLS.length === 351 + OURS.length && SKILLS.filter((x) => !OURS_SET.has(x.id)).length === 351,
  [SKILLS.length, SKILLS.filter((x) => !OURS_SET.has(x.id)).length].join('/'));
ok('A2: категорий 26 (25 донорских + «Решение проблем»), и каждая непустая',
  CATS.length === 26 && CATS.some((c) => c.id === 'problem') && CATS.every((c) => SKILLS.some((s) => s.id !== '_' && s.cat === c.id)),
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
  ok('P4: ни один новый навык не требует инструмента (это правила рассуждения, а не сети)',
    OURS.every((id) => !get(id).tools || !get(id).tools.length) && OURS.every((id) => !get(id).need.length),
    JSON.stringify(OURS.filter((id) => get(id).need.length).map((id) => id + ':' + get(id).need)));
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
