/**
 * Графики картинкой (0.185) — «построй график» значит ПОСТРОЙ, а не «опиши, как
 * построить». Это то, чего у DeepSeek нет вовсе: он отдаёт код, мы — картинку.
 *
 * Как это работает. Модель считает/извлекает данные и оформляет блок:
 *
 *   ```chart|расход по месяцам
 *   type: bar
 *   title: Расход по месяцам
 *   labels: Январь, Февраль, Март
 *   values: 14000, 12300, 15800
 *   ```
 *
 * Движок парсит блок, рисует чистый SVG (столбцы, линия или круговая) и отдаёт
 * его файлом-картинкой — блок из текста ответа изымается, человек видит рисунок
 * в чате. Модель не «рисует»: она называет числа, геометрию ведёт движок —
 * выдуманная красота тут невозможна по построению.
 *
 * Среда та же, что у filegen.js: workerd без nodejs_compat — только Uint8Array,
 * TextEncoder и btoa. Никаких зависимостей, никаких canvas.
 *
 * Честность: блок битый или пустой — это заметка человеку с причиной, а не
 * молчаливая порча ответа.
 */

const MAX_POINTS = 24;        /* точек на один график — дальше это простыня, не график */
const MAX_CHARTS = 3;         /* графиков за один ответ */
const MAX_TITLE = 80;
const MAX_LABEL = 20;
const MAX_SERIES = 24;

const W = 640, H = 400;
const PAD = { l: 56, r: 20, t: 48, b: 46 };

/* Формат блока — тот же почерк, что у ```file: имя после «|», оно необязательно. */
export const CHART_BLOCK_RE = /```[ \t]*chart(?:[ \t]*\|[ \t]*([^\n`]{0,80}))?[ \t]*\r?\n([\s\S]*?)```/gi;

const TYPES = ['bar', 'line', 'pie'];

/* Палитра: фирменный синий первым, дальше различимые по длине волны — круговая
   диаграмма на соседних цветах не должна сливаться. */
const PALETTE = [
  '#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316',
  '#84cc16', '#ec4899', '#14b8a6', '#6366f1', '#eab308', '#22c55e', '#f43f5e',
  '#a855f7', '#0ea5e9', '#d946ef', '#fb923c', '#4ade80', '#facc15', '#38bdf8',
  '#c084fc', '#2dd4bf', '#fb7185',
];

const enc = new TextEncoder();
const b64s = (bytes) => {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
};

/** XML-текст: модель может написать «Q1 <доход>» — скобки не должны ломать SVG. */
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Число: запятая-десятичная и обычная точка; пустое и мусор — NaN. */
function num(s) {
  const t = String(s == null ? '' : s).trim().replace(/\s+/g, '');
  if (!t) return NaN;
  const v = Number(t.replace(',', '.'));
  return Number.isFinite(v) ? v : NaN;
}

/** Разбор значений: «1 400, 2 300» и «1400, 2300» — один и тот же список. */
function parseValues(src) {
  const parts = String(src == null ? '' : src).split(/[,;\n]+/);
  const out = [];
  for (const p of parts) {
    const v = num(p);
    if (Number.isNaN(v)) {
      if (String(p).trim()) throw new Error('значение «' + String(p).trim().slice(0, 16) + '» — не число');
      continue;
    }
    out.push(v);
  }
  /* Потолок проверяется по СПИСКУ ЦЕЛИКОМ: обрезать молча нельзя — человек
     получил бы график, у которого половины данных нет, и не узнал бы об этом. */
  if (out.length > MAX_POINTS) throw new Error('значений больше ' + MAX_POINTS + ' — раздели на два графика');
  return out;
}

/** Круглый потолок оси: 47 → 50, 4723 → 5000, 0.8 → 1. */
export function niceCeil(v) {
  if (!(v > 0)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * pow >= v) return m * pow;
  }
  return 10 * pow;
}

/** Короткое число для подписи: 1500000 → «1,5 млн», 12300 → «12,3 тыс.». */
export function fmtNum(v) {
  const a = Math.abs(v);
  const cut = (x, d) => String(Number(x.toFixed(d))).replace('.', ',');
  if (a >= 1e9) return cut(v / 1e9, 2) + ' млрд';
  if (a >= 1e6) return cut(v / 1e6, 2) + ' млн';
  if (a >= 1e4) return cut(v / 1e3, 1) + ' тыс.';
  return cut(v, a < 1 ? 2 : 1);
}

/** Парсинг тела блока. Бросает с человеческой причиной — упаковщик донесёт её. */
export function parseChart(body) {
  const o = { type: 'bar', title: '', name: '', labels: [], values: [], series: '' };
  const lines = String(body || '').split(/\r?\n/);
  let valuesRaw = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(type|тип|title|заголовок|labels|подписи|values|значения|series|ряд)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'type' || key === 'тип') {
      const t = String(val).toLowerCase().replace(/[^a-zа-яё]/g, '');
      o.type = /^(bar|line|pie|столб|линия|круг)/.test(t)
        ? (t.startsWith('b') || t.startsWith('с') ? 'bar' : t.startsWith('l') || t.startsWith('л') ? 'line' : 'pie')
        : 'bar';
      if (TYPES.indexOf(o.type) < 0) o.type = 'bar';
    } else if (key === 'title' || key === 'заголовок') {
      o.title = val.slice(0, MAX_TITLE);
    } else if (key === 'labels' || key === 'подписи') {
      o.labels = val.split(/[,;\n]+/).map((s) => s.trim().slice(0, MAX_LABEL)).filter(Boolean).slice(0, MAX_POINTS);
    } else if (key === 'series' || key === 'ряд') {
      o.series = val.slice(0, MAX_SERIES);
    } else if (key === 'values' || key === 'значения') {
      valuesRaw = val;
    }
  }
  o.values = parseValues(valuesRaw);
  if (!o.values.length) throw new Error('в блоке нет значений (values:) — нечего рисовать');
  if (o.values.length > MAX_POINTS) throw new Error('значений больше ' + MAX_POINTS + ' — раздели на два графика');
  /* Подписей меньше, чем значений: дописываем номера, а не молчим. */
  while (o.labels.length < o.values.length) o.labels.push(String(o.labels.length + 1));
  o.labels = o.labels.slice(0, o.values.length);
  if (o.type === 'pie' && o.values.length < 2) throw new Error('круговой диаграмме нужны хотя бы два значения');
  return o;
}

/** SVG-текст графика. Всегда один и тот же каркас — меняются только данные. */
export function renderChart(c) {
  const parts = [];
  const textC = '#1f2937', mutC = '#6b7280', gridC = '#e5e7eb', axisC = '#9ca3af';
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">`);
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  const cx = W / 2;
  if (c.title) parts.push(`<text x="${cx}" y="26" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="16" font-weight="600" fill="${textC}">${esc(c.title)}</text>`);
  if (c.series && c.type !== 'pie') parts.push(`<text x="${cx}" y="44" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="11" fill="${mutC}">${esc(c.series)}</text>`);

  if (c.type === 'pie') {
    const total = c.values.reduce((a, b) => a + Math.abs(b), 0);
    if (!(total > 0)) throw new Error('сумма значений нулевая — круг не начертишь');
    const ccx = W * 0.36, ccy = (H + (c.title ? 16 : 0)) / 2, r = Math.min(W * 0.3, H * 0.36);
    let a0 = -Math.PI / 2;
    for (let i = 0; i < c.values.length; i++) {
      const frac = Math.abs(c.values[i]) / total;
      const a1 = a0 + frac * Math.PI * 2;
      const large = frac > 0.5 ? 1 : 0;
      const x0 = ccx + r * Math.cos(a0), y0 = ccy + r * Math.sin(a0);
      const x1 = ccx + r * Math.cos(a1), y1 = ccy + r * Math.sin(a1);
      parts.push(`<path d="M ${ccx} ${ccy} L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z" fill="${PALETTE[i % PALETTE.length]}" stroke="#ffffff" stroke-width="2"/>`);
      /* Подпись сектора — только если сектор не микроскопический. */
      if (frac >= 0.04) {
        const mid = (a0 + a1) / 2, lr = r * 0.62;
        const lx = ccx + lr * Math.cos(mid), ly = ccy + lr * Math.sin(mid);
        const pct = Math.round(frac * 1000) / 10;
        parts.push(`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="11" font-weight="600" fill="#ffffff">${String(pct).replace('.', ',')}%</text>`);
      }
      a0 = a1;
    }
    /* Легенда справа: цвет, подпись, процент — читается без угадывания. */
    const ly0 = c.title ? 64 : 40;
    for (let i = 0; i < c.labels.length; i++) {
      const y = ly0 + i * 24;
      if (y > H - 16) break;
      const pct = Math.round((Math.abs(c.values[i]) / total) * 1000) / 10;
      parts.push(`<rect x="${W * 0.68}" y="${y - 9}" width="12" height="12" rx="3" fill="${PALETTE[i % PALETTE.length]}"/>`);
      parts.push(`<text x="${W * 0.68 + 18}" y="${y + 1}" font-family="system-ui,-apple-system,sans-serif" font-size="12" fill="${textC}">${esc(c.labels[i])} · ${String(pct).replace('.', ',')}%</text>`);
    }
  } else {
    const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
    const maxV = Math.max(...c.values.map(Math.abs), 0);
    const top = niceCeil(maxV);
    /* Сетка: 4 линии + подписи оси. Ноль — осью. */
    for (let g = 0; g <= 4; g++) {
      const v = (top / 4) * g;
      const y = PAD.t + ih - (ih * g) / 4;
      parts.push(`<line x1="${PAD.l}" y1="${y.toFixed(1)}" x2="${W - PAD.r}" y2="${y.toFixed(1)}" stroke="${g === 0 ? axisC : gridC}" stroke-width="1"/>`);
      parts.push(`<text x="${PAD.l - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-family="system-ui,-apple-system,sans-serif" font-size="11" fill="${mutC}">${esc(fmtNum(v))}</text>`);
    }
    const step = iw / c.values.length;
    const showLabelEvery = c.values.length > 10 ? Math.ceil(c.values.length / 10) : 1;
    if (c.type === 'bar') {
      const bw = Math.min(step * 0.62, 64);
      for (let i = 0; i < c.values.length; i++) {
        const h = (Math.abs(c.values[i]) / top) * ih;
        const x = PAD.l + step * i + (step - bw) / 2;
        const y = PAD.t + ih - h;
        parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}" rx="4" fill="${PALETTE[i % PALETTE.length]}"/>`);
        if (c.values.length <= 12) {
          parts.push(`<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="11" font-weight="600" fill="${textC}">${esc(fmtNum(c.values[i]))}</text>`);
        }
        if (i % showLabelEvery === 0) {
          parts.push(`<text x="${(PAD.l + step * i + step / 2).toFixed(1)}" y="${H - PAD.b + 16}" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="11" fill="${mutC}">${esc(c.labels[i])}</text>`);
        }
      }
    } else { /* line */
      const px = (i) => PAD.l + step * i + step / 2;
      const py = (v) => PAD.t + ih - (Math.abs(v) / top) * ih;
      const pts = c.values.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
      parts.push(`<polyline points="${pts}" fill="none" stroke="${PALETTE[0]}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`);
      for (let i = 0; i < c.values.length; i++) {
        parts.push(`<circle cx="${px(i).toFixed(1)}" cy="${py(c.values[i]).toFixed(1)}" r="4" fill="#ffffff" stroke="${PALETTE[0]}" stroke-width="2.5"/>`);
        if (c.values.length <= 12) {
          parts.push(`<text x="${px(i).toFixed(1)}" y="${(py(c.values[i]) - 10).toFixed(1)}" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="11" font-weight="600" fill="${textC}">${esc(fmtNum(c.values[i]))}</text>`);
        }
        if (i % showLabelEvery === 0) {
          parts.push(`<text x="${px(i).toFixed(1)}" y="${H - PAD.b + 16}" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="11" fill="${mutC}">${esc(c.labels[i])}</text>`);
        }
      }
    }
  }
  parts.push('</svg>');
  return parts.join('\n');
}

const cleanRest = (s) => String(s).replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();

function slugOf(s, fallback) {
  const out = String(s || '').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  return out || fallback;
}

/**
 * Вынуть графики из ответа. Тот же контракт, что packFiles у filegen:
 * { reply, files, notes } — блоки изъяты из текста, картинки приложены,
 * битый блок оставил причину, а не дырку.
 */
export function packCharts(answer) {
  const src = String(answer || '');
  if (src.indexOf('```chart') < 0 && src.indexOf('``` chart') < 0) return { reply: answer, files: [], notes: [] };
  const files = [];
  const notes = [];
  let last = null;
  const reply = src.replace(CHART_BLOCK_RE, (all, name, body) => {
    if (files.length >= MAX_CHARTS) {
      notes.push('графиков больше ' + MAX_CHARTS + ' за ответ — остальные остались текстом');
      return all;
    }
    try {
      const chart = parseChart(body);
      if (!chart.title && name) chart.title = String(name).trim().slice(0, MAX_TITLE);
      const svg = renderChart(chart);
      const buf = enc.encode(svg);
      if (buf.length > 512 * 1024) throw new Error('svg больше 512 КБ');
      const base = slugOf(String(name || '').trim() || chart.title || 'график', 'график');
      const f = { name: base + '.svg', mime: 'image/svg+xml', size: buf.length, b64: b64s(buf), kind: 'image', source: 'chart' };
      files.push(f);
      last = f;
      return '';
    } catch (e) {
      notes.push('график не построен: ' + (e && e.message ? e.message : e));
      return '';
    }
  });
  const clean = cleanRest(reply);
  return { reply: clean, files, notes };
}
