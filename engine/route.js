/**
 * Куда отправить запрос — порт роутера Yama (Этап 1).
 *
 * Классификатор — не «красивое слово», а единственное, что отличает «спроси болтовню
 * у coder-модели» от «дай код модели, которая пишет код». Поэтому таблицы примет
 * перенесены как есть, включая порядок проверок: он выстраивался на живых промахах
 * («сравни postgres и mysql» содержит `sql`, но это не программа).
 *
 * Отличие от Yama: живого реестра OpenRouter здесь нет (в воркере его негде кэшировать),
 * поэтому зрение определяется по примете имени + белому списку «точно не видит».
 */

export const CODE_HINT = /(код|code|скрипт|функц|программ|алгоритм|баг|ошибка.*код|рефактор|api|sql|python|javascript|typescript|js\b|ts\b|html|css|git|докер|docker|напиши.*код|исправь.*код|leetcode|олимпиад|codeforces|atcoder|hackerrank|advent of code|сложность o\(|unittest|pytest)/i;
export const CODE_EXTRA = /(сниппет|снипет|snippet|ревью|review|асинхрон|async|await|промис|promise|колбэк|callback|гонк[аи]|дедлок|deadlock|утечк[аи] памяти|memory leak|сверст[аай]|вёрстк|верстк|макет|регулярк|regexp?|exception|nullpointer|stack ?overflow|тест[ыа].*функц|юнит-?тест|класс|метод.*класс|запрос.*баз|баз[аы] данных|миграц)/i;
export const WRITE_CODE_HINT = /(напиши|реализуй|leetcode|олимпиад|codeforces|atcoder|рефактор|исправь.*код|скрипт|программ)/i;
export const REASON_HINT_EXTRA = /(анализ|разбер|сравни|почему|докажи|стратег|план|исслед|объясни.*подробно|резюме|вывод|гипотез|причин)/i;
export const COMPARE_LIVE = /(сравни|сравн[\s\S]{0,20}(между|с\s)|разниц[ау]?\s+между|в\s+ч[её]м\s+разниц|чем\s+отлича|отлича[ею]тся?\s+[\s\S]{0,40}\s+от|отличи[ея]\s+[\s\S]{0,40}\s+от|что\s+лучше|что\s+выбрать|како[йе][\s\S]{0,24}лучше|плюс[ыа]\s+и\s+минус|за\s+и\s+против)/i;
export const CODE_ARTIFACT = /(этот\s+код|этот\s+сниппет|эта\s+функц|этот\s+класс|этот\s+метод|мой\s+код|мо[яё]\s+функц|в\s+этом\s+код|в\s+коде|напиши|реализуй|исправь|отрефактор|перепиши|добавь\s+тест|сверст[аай]|regex|регулярк)/i;
export const REASON_LIVE = /(в\s*ч[её]м\s+разниц|разниц[ау]?\s+между|чем\s+отлича|отлича[ею]тся?\s+.*от|отличи[ея]\s+.*от|как\s+работает|как\s+устроен|устроен[аоы]?\s|что\s+лучше|что\s+выбрать|како[йе][\s\S]{0,20}лучше|плюс[ыа]\s+и\s+минус|за\s+и\s+против|каки[ех]\s+риски|оцени\s+риски|изложи\s+суть|простыми\s+словами|в\s+ч[её]м\s+суть|спланируй|составь\s+план|пошагов)/i;
export const MATH_HINT = /(посчитай|вычисли|реши.*задач|уравнен|математ|формула|интеграл|производн|факториал|комбинатор|вероятност|теорем|геометри|тригонометр|логарифм|нод|нок|gcd|lcm|дифференциал|система уравн|дискриминант|квадратн|арифметическ|геометрическ.*прогресс|прост(ое|ых) чис|разлож.*множит|предел|матриц|вектор|корень|sqrt|sin\(|cos\(|tan\(|log\(|ln\(|n!|\d+!|c\(\s*\d+|binom|процент.*от|\d+\s*[+\-*/^]\s*\d)/i;
export const MATH_LIVE = /(раздел[иить]+\s+.{0,24}\s+на\s+\d|с\s+остатком|остаток\s+от|в\s+степени|степень\s+числа|сколько\s+способов|скольк[оии][\s\S]{0,30}способ|переведи\s+[\d,.\s]+|[\d,]+\s*(км|километр|миль|метр|кг|грамм|фунт|галлон|литр|дюйм|фут|ярд|акр|гектар)[\s\S]{0,24}\s+в\s+|вырос(ла|ло|ли)?\s+на\s+[\d,]+\s*%|упал[аио]?\s+на\s+[\d,]+\s*%|увелич[\s\S]{0,12}на\s+[\d,]+\s*%|уменьш[\s\S]{0,12}на\s+[\d,]+\s*%|на\s+[\d,]+\s*%\s+(больше|меньше|выгоднее)|какая\s+вероятность|каков[ао]?\s+шанс)/i;
export const CREATIVE_HINT = /(сочини|придумай|история|рассказ|стих|сценарий|креатив|иде[яи])/i;
export const CREATIVE_LIVE = /(накида[йя][\s\S]{0,12}идей|подкинь\s+идей|генерируй\s+идеи|вариант[ыа]\s+названи|нейминг|слоган|придум[аа]й\s+названи)/i;
export const LONG_REASON_CHARS = 100;

/* Зрение по примете имени. `flash` сюда намеренно не входит: под него попадали
   glm-4.7-flash и qwen3.7-flash, картинка уезжала слепой модели, та отвечала
   «не вижу изображение», и обход сжигал на это квоту. */
export const VISION_HINT = /(^|[^a-z0-9])(gemini-|vl|omni|vision|4o|scout|pixtral|4v|nano-banana|gemma-3)/i;
export const REASON_HINT = /(-reasoning|-thinking|think|r1-|o1|o3|gpt-oss|qwen3|magistral|inkling|dots-3-note|deepseek-r|nex-n2\.5-pro)/i;

/* Каталог врёте наживую у всех — поэтому белый список «в имени всё есть, а зрения нет». */
export const KNOWN_NO_VISION = [
  'inclusionai/ling-3.0-flash-sante:free',
  'inclusionai/ling-3.0-flash-fin:free',
  'liquid/lfm-2.5-2.6b:free',
  'poolside/laguna-s-2.1:free',
];

export function isVision(model) {
  const s = String(model || '');
  return VISION_HINT.test(s) && KNOWN_NO_VISION.indexOf(s) < 0;
}
export function isReasoning(model) {
  return REASON_HINT.test(String(model || ''));
}

/** code | math | reasoning | vision | creative | fast — по тексту и наличию картинки. */
/**
 * Задача, у которой есть верный ответ, записанный числом: «съели / осталось /
 * всего / проехал». Классификатор и совет голов смотрят на один и тот же
 * признак — раньше они расходились, и арифметика в формулировке задачи
 * уходила в дешёвый слой, а «исправлять» её должен был ансамбль.
 */
export const WORD_PROBLEM = /(остал[оа]сь|осталось|всего|съел|отдал|забрал|потрат|прибав|расход|прош[ёе]л|проехал|проплыл|купил|привез|развез|скорост|за \d+ (?:день|дн|час|минут)|по \d+ (?:за|в) )/i;
export const COUNT_ASK = /(сколько|скольк|посчитай|вычисл|рассчитай|найти|остаток|процент|како[ей]|кака[я])\s*\S*?$/i;
export const COUNT_ASK_ANY = /(сколько|скольк|посчитай|вычисл|рассчитай|како[ей] (?:число|итог|сумма|ответ)|найди (?:сколько|итог))/i;

export function classifyTask(text, images) {
  const t = String(text || '').toLowerCase();
  if (images && images.length) return 'vision';
  const isCode = CODE_HINT.test(t) || CODE_EXTRA.test(t);
  const isMath = MATH_HINT.test(t) || MATH_LIVE.test(t);
  const writeCode = WRITE_CODE_HINT.test(t);
  const isReason = REASON_HINT_EXTRA.test(t) || REASON_LIVE.test(t);
  const isCompare = COMPARE_LIVE.test(t);
  const isDebug = CODE_ARTIFACT.test(t);
  if (isCompare) return 'reasoning';
  if (isCode && (writeCode || isDebug)) return 'code';
  /* Арифметика в человеческой формулировке: два числа, слово расхода и вопрос
     про итог. Это «math», а не «fast»: цена ошибки выше цены секунды. */
  const nums = (t.match(/\d+/g) || []).length;
  if (nums >= 2 && WORD_PROBLEM.test(t) && COUNT_ASK_ANY.test(t)) return 'math';
  if (isReason && !writeCode) return 'reasoning';
  if (isMath) return 'math';
  if (isCode) return 'code';
  if (CREATIVE_HINT.test(t) || CREATIVE_LIVE.test(t)) return 'creative';
  if (t.length < 60 && !/почему|зачем|как.*сделать/.test(t)) return 'fast';
  if (t.length >= LONG_REASON_CHARS) return 'reasoning';
  return 'fast';
}

/**
 * tier по задаче: smart — там, где цена ошибки выше цены секунды.
 * В Yama это решалось внутри роутера вместе с реестром; здесь — явно и коротко,
 * чтобы решение было видно и его можно было переопределить из запроса.
 */
export function tierFor(intent) {
  if (intent === 'code' || intent === 'math' || intent === 'reasoning' || intent === 'vision') return 'smart';
  return 'fast';
}

/**
 * Очередь моделей внутри провайдера.
 *  • с картинкой — зрячие первыми;
 *  • «думающие» — последними: они сжигают бюджет токенов на внутренние размышления
 *    и на длинном ответе обрезаются на первых словах (в Yama на этом потеряли
 *    не один вечер);
 *  • для кода и математики думающих не прячем — там они и нужны.
 */
export function modelsFor(cfg, tier, intent, images) {
  let list = (cfg.modelsLocal || (cfg.models && cfg.models[tier]) || (cfg.models && cfg.models.fast) || []).slice();
  if (!list.length) return list;
  /* Порядок важнее состава: сначала зрение, потом «не сжигай бюджет на размышления».
     Переставить местами — и картинка уйдёт слепой модели (проверено на Yama). */
  if (images && images.length) {
    const see = list.filter((m) => isVision(m));
    if (see.length) list = see.concat(list.filter((m) => see.indexOf(m) < 0));
  }
  const keepThinkers = intent === 'code' || intent === 'math' || intent === 'reasoning' || intent === 'vision';
  if (!keepThinkers) {
    const calm = list.filter((m) => !isReasoning(m));
    if (calm.length) list = calm.concat(list.filter((m) => calm.indexOf(m) < 0));
  }
  return list;
}
