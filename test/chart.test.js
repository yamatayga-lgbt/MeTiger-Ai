/**
 * 0.185 — графики картинкой: «построй график» значит ПОСТРОЙ.
 *
 * Модель называет числа в блоке ```chart, геометрию ведёт движок
 * (engine/chart.js), человек получает файл-картинку (image/svg+xml) в чате.
 * Проверяем парсер, рендер всех трёх типов, честность на битых блоках
 * и то, что блок изымается из текста ответа.
 *
 *   node test/chart.test.js
 */
import { parseChart, renderChart, packCharts, niceCeil, fmtNum } from '../engine/chart.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✖ ' + name + (extra ? ' — ' + String(extra).slice(0, 160) : '')); }
};

console.log('C — парсер блока chart');
{
  const c = parseChart('type: bar\ntitle: Расход\nlabels: Январь, Февраль, Март\nvalues: 14000, 12300, 15800');
  ok('C1: тип, заголовок, подписи и числа читаются',
    c.type === 'bar' && c.title === 'Расход' && c.labels.join() === 'Январь,Февраль,Март'
      && c.values.join() === '14000,12300,15800', JSON.stringify(c));
  ok('C2: подписей меньше, чем значений, — дописаны номера, а не молчание',
    parseChart('values: 1, 2, 3, 4').labels.join() === '1,2,3,4');
  ok('C3: точка-десятичная читается; запятая — разделитель списка (формат указания)',
    parseChart('values: 1.5, 2.5, 3').values.join() === '1.5,2.5,3');
  ok('C4: мусор в значениях — внятная причина, а не тихий NaN',
    (() => { try { parseChart('values: abc, 2'); return false; } catch (e) { return /не число/.test(e.message); } })());
  ok('C5: пустой values — отказ с причиной',
    (() => { try { parseChart('labels: a, b'); return false; } catch (e) { return /нет значений/.test(e.message); } })());
  ok('C6: pie с одним значением не строится',
    (() => { try { parseChart('type: pie\nvalues: 5'); return false; } catch (e) { return /два значения/.test(e.message); } })());
  ok('C7: больше 24 точек — отказ с предложением разделить',
    (() => { try { parseChart('values: ' + Array.from({ length: 30 }, (_, i) => i + 1).join(', ')); return false; } catch (e) { return /24/.test(e.message); } })());
}

console.log('R — рендер SVG');
{
  const bar = renderChart(parseChart('title: Тест\nlabels: A, B, C, D\nvalues: 10, 40, 25, 5'));
  ok('R1: bar — по rect на значение, ось и сетка на месте',
    (bar.match(/<rect x=/g) || []).length === 4 && bar.indexOf('<line') >= 0 && bar.indexOf('</svg>') > 0, bar.slice(0, 120));
  ok('R2: подписи оси Y — круглый потолок, а не «43,7»',
    bar.indexOf('>50<') > 0 || bar.indexOf('>50 </') > 0 || />50</.test(bar), (bar.match(/>([\d,.]+[^<]*)<\/text>/g) || []).slice(0, 6).join(' | '));
  const line = renderChart(parseChart('type: line\nlabels: 1, 2, 3\nvalues: 5, 9, 7'));
  ok('R3: line — polyline и точки на данных',
    (line.match(/<polyline /g) || []).length === 1 && (line.match(/<circle /g) || []).length === 3);
  const pie = renderChart(parseChart('type: pie\nlabels: Да, Нет, Может быть\nvalues: 5, 3, 2'));
  ok('R4: pie — по сектору на значение, проценты в легенде',
    (pie.match(/<path /g) || []).length === 3 && pie.indexOf('50%') >= 0 && pie.indexOf('30%') >= 0 && pie.indexOf('20%') >= 0, (pie.match(/>\d+(?:,\d+)?%</g) || []).join());
  ok('R5: XML-опасные символы в подписи не ломают SVG',
    (() => { const s = renderChart(parseChart('labels: <доход>, B\nvalues: 1, 2')); return s.indexOf('&lt;доход&gt;') >= 0 && s.indexOf('</svg>') > 0; })());
}

console.log('P — упаковка ответа');
{
  const full = 'Вот график расходов:\n\n```chart|расход\nlabels: A, B, C\nvalues: 1, 2, 3\n```\nВидно рост.';
  const p = packCharts(full);
  ok('P1: блок изъят из текста, файл приложен',
    p.reply.indexOf('```') < 0 && p.reply.indexOf('Видно рост') >= 0 && p.reply.indexOf('Вот график') >= 0, p.reply);
  ok('P2: файл — настоящая картинка для чата (mime svg, kind image)',
    p.files.length === 1 && p.files[0].mime === 'image/svg+xml' && p.files[0].kind === 'image'
      && p.files[0].name === 'расход.svg' && p.files[0].b64.length > 50, JSON.stringify(p.files.map((f) => f.name)));
  ok('P3: b64 разворачивается в валидный SVG',
    Buffer.from(p.files[0].b64, 'base64').toString('utf8').indexOf('</svg>') > 0);
  const bad = 'Ответ\n\n```chart|битый\nvalues: раз, два\n```\n\nКонец.';
  const pb = packCharts(bad);
  ok('P4: битый блок — заметка с причиной, ответ не испорчен',
    pb.notes.length === 1 && /график не построен/.test(pb.notes[0]) && pb.reply.indexOf('Конец') >= 0, pb.notes.join());
  const none = 'Просто текст без блоков.';
  ok('P5: без блока ответ проходит насквозь без файлов и заметок',
    (() => { const r = packCharts(none); return r.reply === none && r.files.length === 0 && r.notes.length === 0; })());
  const two = packCharts('```chart|один\nvalues: 1, 2\n```\nсередина\n```chart|два\nvalues: 3, 4\n```');
  ok('P6: два графика за ответ — оба приложены',
    two.files.length === 2 && two.files[0].name === 'один.svg' && two.files[1].name === 'два.svg', two.files.map((f) => f.name).join());
  ok('P7: без имени имя берётся из заголовка, без заголовка — «график»',
    packCharts('```chart\ntitle: Прибыль\nvalues: 1, 2\n```').files[0].name === 'Прибыль.svg'
      && packCharts('```chart\nvalues: 1, 2\n```').files[0].name === 'график.svg');
}

console.log('N — числа по-человечески');
ok('N1: niceCeil — круглый потолок оси',
  niceCeil(47) === 50 && niceCeil(4723) === 5000 && niceCeil(0.8) === 1 && niceCeil(0) === 1);
ok('N2: fmtNum — «1,5 млн» и «12,3 тыс.», а не 1500000',
  fmtNum(1500000) === '1,5 млн' && fmtNum(12300) === '12,3 тыс.' && fmtNum(7) === '7');

/* 0.196: графики по данным из файлов — указание графика требует реальных чисел
   из приложенных файлов, а навык data-charts больше не противоречит 0.185. */
console.log('F — график по данным из файла (0.196)');
{
  const { gatherTools } = await import('../engine/tools.js');
  const r = await gatherTools('построй график по данным из приложённого файла', {}, async () => ({ status: 200, text: async () => '' }));
  const chartTool = r.directive || '';
  ok('F1: указание графика велит брать числа из файлов и не выдумывать',
    /файлы с данными/.test(chartTool) && /ТОЛЬКО из них/i.test(chartTool.replace(/ТОЛЬКО/i, 'ТОЛЬКО')),
    JSON.stringify(chartTool.slice(0, 80)));
  const data = (await import('node:fs')).readFileSync('engine/skills/data.js', 'utf8');
  ok('F2: навык data-charts за блок ```chart, а не за код на matplotlib',
    /график — картинкой, без кода/.test(data) && /движок приложения нарисует/.test(data)
      && !/matplotlib/.test(data));
}

console.log(`\n${pass} ✔, ${fail} ✖`);
if (fail) process.exit(1);
console.log('✔ 0.185: графики картинкой — проверки пройдены');
