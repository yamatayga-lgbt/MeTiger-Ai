/**
 * «Разное мышление» под разный язык программирования.
 *
 * Когда человек просит код или присылает код на языке L, подсказываем модели
 * думать в терминах этого языка, а не абстрактно. Это короткая инструкция, которая
 * ложится в system-промпт рядом с навыками (engine/chat.js), не заменяя их — она
 * только задаёт «ментальную модель»: списки вместо циклов для Python, наборы и JOIN
 * для SQL, владение памятью для C++, trait/Result для Rust и так далее.
 *
 * Runtime-независимо: никаких process.env/fs; чистый текст, годится и для Worker, и
 * для Pages Function, и для Node-тестов.
 */

const LANGS = {
  python: {
    label: 'Python',
    mind: '[Thinking in Python]: Мысли в терминах списков, генераторов и duck typing; '
      + 'стандартная библиотека богатая (itertools, collections, pathlib) — используй её до сторонних пакетов. '
      + 'Соблюдай PEP 8, отступы — 4 пробела. Код запускается в браузере через Pyodide: есть стандартная '
      + 'библиотека, НЕТ доступа к файловой системе хоста и к pip-пакетам вне сборки.',
  },
  javascript: {
    label: 'JavaScript',
    mind: '[Thinking in JavaScript (browser, no Node)]: Мысли в терминах событий, промисов и асинхронности; '
      + 'это браузерный JS, без require/process/Node API (песочница их не даёт). Используй const/let, '
      + 'стрелочные функции, async/await. DOM и addEventListener доступны только в превью, не в исполняемой песочнице.',
  },
  typescript: {
    label: 'TypeScript',
    mind: '[Thinking in TypeScript]: Мысли в терминах типов, дженериков и узких (narrowed) типов; '
      + 'аннотируй функции и возвраты, не полагайся на any. Код перед запуском транспилируется в JS (sucrase) '
      + 'и исполняется в браузере — значит без Node API и без типов времени выполнения (interface/type испаряются).',
  },
  sql: {
    label: 'SQL',
    mind: '[Thinking in SQL / relational]: Мысли реляционно — наборы строк, JOIN, агрегаты (GROUP BY), '
      + 'оконные функции и индексы; избегай пошаговых циклов там, где хватит одного запроса. '
      + 'Песочница исполняет SQL через sql.js (SQLite): поддерживаются CREATE/INSERT/SELECT, НЕТ хранимых '
      + 'процедур и спец-синтаксиса конкретных СУБД. Покажи результат таблицей.',
  },
  cpp: {
    label: 'C++',
    mind: '[Thinking in C++]: Мысли в терминах владения памятью, RAII, указателей и ссылок, явного UB; '
      + 'управляй временем жизни ресурса, предпочитай контейнеры STL (vector/map) сырым массивам.',
  },
  c: {
    label: 'C',
    mind: '[Thinking in C]: Мысли в терминах указателей, ручного выделения (malloc/free) и границ массивов; '
      + 'проверяй NULL и размеры буферов, ошибки возвращай через коды/K&R-соглашения.',
  },
  csharp: {
    label: 'C#',
    mind: '[Thinking in C#]: Мысли в терминах классов, LINQ, async/await и управляемой памяти (GC); '
      + 'используй nullable-аннотации и try/catch для исключений.',
  },
  java: {
    label: 'Java',
    mind: '[Thinking in Java]: Мысли в терминах классов, интерфейсов, обобщений (generics) и проверяемых '
      + 'исключений; работай с коллекциями JDK, а не с сырыми массивами.',
  },
  rust: {
    label: 'Rust',
    mind: '[Thinking in Rust]: Мысли в терминах владения (ownership) и заимствования (borrowing), Result/Option '
      + 'вместо null, trait-ов как интерфейсов; ошибки обрабатывай явно, мутабельность — под вопросом mut.',
  },
  go: {
    label: 'Go',
    mind: '[Thinking in Go]: Мысли в терминах горутин, каналов и явной обработки ошибок (error как значение, '
      + 'if err != nil); интерфейсы неявные, пакеты плоские.',
  },
  ruby: {
    label: 'Ruby',
    mind: '[Thinking in Ruby]: Мысли в терминах блоков, метапрограммирования и «душистого» кода (конвенции '
      + 'именования snake_case, attr_accessor); минимум церемоний, максимум выразительности.',
  },
  php: {
    label: 'PHP',
    mind: '[Thinking in PHP]: Мысли в терминах массивов-на-всё, встроенных функций и request/response цикла; '
      + 'экранируй вывод (htmlspecialchars) и используй PDO с параметрами против SQL-инъекций.',
  },
  swift: {
    label: 'Swift',
    mind: '[Thinking in Swift]: Мысли в терминах опционалов (Optional), value-типов (struct/enum) и протоколов; '
      + 'безопасная работа с nil через if let / guard let.',
  },
  kotlin: {
    label: 'Kotlin',
    mind: '[Thinking in Kotlin]: Мысли в терминах null-безопасности (?.), data-классов и расширений (extension); '
      + 'лаконичнее Java, но JVM-совместим.',
  },
  lua: {
    label: 'Lua',
    mind: '[Thinking in Lua]: Мысли в терминах таблиц (единственная структура данных), метатаблиц и 1-индексации; '
      + 'нет классов — только таблицы и прототипы.',
  },
  bash: {
    label: 'Bash/Shell',
    mind: '[Thinking in Shell]: Мысли в терминах конвейеров (pipe), утилит и кодов возврата ($?); '
      + 'котировка переменных ("$var") обязательна, условия — через test/[[',
  },
  html: {
    label: 'HTML/CSS',
    mind: '[Thinking in HTML/CSS]: Мысли в терминах семантической разметки и каскада; структуру — HTML, '
      + 'вид — CSS. Песочница рендерит это как превью в изолированном iframe: пиши валидную разметку, '
      + 'избегай устаревших тегов.',
  },
  css: {
    label: 'CSS',
    mind: '[Thinking in CSS]: Мысли в терминах каскада, специфичности и блочной модели; пиши семантические '
      + 'классы, избегай !important, проверяй адаптив через медиазапросы.',
  },
  r: {
    label: 'R',
    mind: '[Thinking in R]: Мысли в терминах векторизованных операций и дата-фреймов (dplyr/tidyverse); '
      + 'избегай явных циклов там, где хватит векторного действия.',
  },
}

/** Алиас (из ```-блока или речи) → ключ языка. */
const ALIASES = {
  py: 'python', python: 'python', python3: 'python', py3: 'python',
  js: 'javascript', javascript: 'javascript', node: 'javascript', nodejs: 'javascript',
  ts: 'typescript', typescript: 'typescript', tsx: 'typescript',
  sql: 'sql', sqlite: 'sql', postgres: 'sql', postgresql: 'sql', mysql: 'sql', tsql: 'sql',
  cpp: 'cpp', 'c++': 'cpp', cc: 'cpp', 'c#': 'csharp', csharp: 'csharp', cs: 'csharp',
  c: 'c',
  java: 'java',
  rs: 'rust', rust: 'rust',
  golang: 'go', go: 'go',
  rb: 'ruby', ruby: 'ruby',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin', kotlin: 'kotlin',
  lua: 'lua',
  sh: 'bash', bash: 'bash', shell: 'bash', zsh: 'bash',
  html: 'html', html5: 'html',
  css: 'css', scss: 'css', sass: 'css',
  r: 'r',
}

/**
 * Определить язык из текста человека. Консервативно: в первую очередь — помеченный
 * ```-блок, затем явная фраза «на <язык>»; иначе null (не догадываемся на ровном месте).
 * @param {string} text
 * @returns {string|null} ключ из LANGS или null
 */
export function detectLang(text) {
  const t = String(text || '')
  /* 1) Помеченный блок кода: ```python ... Вот он — язык точно известен. */
  const fence = /```([a-zA-Z0-9_+#.-]{1,20})/.exec(t)
  if (fence) {
    const k = ALIASES[fence[1].toLowerCase()]
    if (k) return k
  }
  /* 2) Явная фраза «напиши на python», «код на sql», «скрипт на js» и т.п.
     Без ведущего \b: в JS \b — ASCII-граница, а кириллица не считается \w, и на
     «напиши» у начала строки граница бы не совпала — язык бы не детектился. */
  const phrase = /(?:напиши|реализуй|напиш|сделай|код|скрипт|программ[ау]|функц|на\s+язык[еи]?)\s+(?:на\s+)?([a-z#+]{2,12})\b/i.exec(t)
  if (phrase) {
    const k = ALIASES[phrase[1].toLowerCase()]
    if (k) return k
  }
  /* 3) Прямое называние языка в речи («на python», «в rust», «code in python»). */
  const named = /(?:на|в|using|on|in)\s+(python|javascript|typescript|rust|golang|go|java|ruby|php|swift|kotlin|lua|sql|html|css|r)\b/i.exec(t)
  if (named) {
    const k = ALIASES[named[1].toLowerCase()]
    if (k) return k
  }
  return null
}

/** Короткая установка «мыслить в языке L» для system-промпта, или null. */
export function langMind(langId) {
  const l = LANGS[langId]
  return l ? l.mind : null
}

/** Человекочитаемая метка языка (для отладки/логов), или null. */
export function langLabel(langId) {
  const l = LANGS[langId]
  return l ? l.label : null
}
