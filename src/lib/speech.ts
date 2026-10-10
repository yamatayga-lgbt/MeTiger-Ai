/**
 * Озвучка ответов на стороне человека.
 *
 * Порядок такой: сначала пробуем серверный голос (POST /api/tts) — он звучит
 * живой речью. Если сервер не смог (служба голоса молчит, связи нет, потолок
 * частоты) — читаем речью самого устройства (речевой движок телефона). Речь
 * устройства использует установленный голос нужного языка (либо выбор движка
 * браузера по locale) и потому служит честным запасным путём: без него кнопка
 * «озвучить» превратилась бы в обещание, которое не выполняется.
 *
 * Текст для речи готовит движок (engine/voiceout.js): разметка и формулы
 * превращаются в устную форму. Чтобы не держать вторую копию этого разбора в
 * браузере, при откате на устройство мы спрашиваем у входа готовый текст
 * (?text=1) — источник правды один.
 */

/** Играющий сейчас звук: озвучка одна на всё приложение (как и у людей — один голос). */
let текущий: HTMLAudioElement | null = null;
let текущийСтоп: (() => void) | null = null;

export type SpeechState = 'play' | 'end' | 'error' | 'нет голоса';

/** Остановить всё, что звучит: и серверный голос, и речь устройства. */
export function stopSpeech(): void {
  if (текущий) {
    try { текущий.pause(); } catch { /* уже остановлен */ }
    if (текущий.src) URL.revokeObjectURL(текущий.src);
    текущий = null;
  }
  if (текущийСтоп) {
    /* Речь устройства не всегда возвращает объект speechSynthesis — держим свою функцию отмены. */
    try { текущийСтоп(); } catch { /* уже отменена */ }
    текущийСтоп = null;
  }
}

/** Голос устройства под выбранный язык; без подсказки сохраняем русский по умолчанию. */
export function deviceVoice(language?: string): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const requested = String(language || '').trim().toLowerCase().replace(/_/g, '-');
  if (requested) {
    const base = requested.split('-')[0];
    return voices.find((g) => g.lang.toLowerCase().replace(/_/g, '-') === requested)
      || voices.find((g) => g.lang.toLowerCase().replace(/_/g, '-').split('-')[0] === base)
      || null
  }
  return voices.find((g) => /^ru/i.test(g.lang)) || voices.find((g) => /ru/i.test(g.lang)) || null;
}

/** Речь устройства: говорим подготовленный текст. */
function speakDevice(speech: string, language: string, onState: (s: SpeechState) => void): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) { onState('нет голоса'); return; }
  const голос = deviceVoice(language);
  if (!window.speechSynthesis.getVoices().length) { onState('нет голоса'); return; }
  const u = new SpeechSynthesisUtterance(speech);
  if (голос) u.voice = голос;
  u.lang = language || голос?.lang || 'ru-RU';
  u.rate = 1;
  let закончен = false;
  u.onstart = () => onState('play');
  u.onend = () => { закончен = true; текущийСтоп = null; onState('end'); };
  u.onerror = () => { закончен = true; текущийСтоп = null; onState('error'); };
  текущийСтоп = () => {
    if (закончен) return;
    закончен = true;
    window.speechSynthesis.cancel();
    onState('end');
  };
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

/** Устная форма текста с сервера — та же, что уходит в серверный голос. */
async function speechForm(text: string, language: string): Promise<{ speech: string; language: string }> {
  const r = await fetch('/api/tts?text=1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, language }),
  });
  const j = await r.json().catch(() => null);
  return (j && j.ok && j.speech)
    ? { speech: String(j.speech), language: String(j.language || language) }
    : { speech: '', language };
}

/**
 * Озвучить текст. Возвращает причину, если не вышло (её показываем подписью в
 * кнопке), и зовёт onState на каждом переходе — по нему рисуется «играет».
 */
export async function speak(
  text: string,
  opts: { gender?: 'male' | 'female'; language?: string; onState?: (s: SpeechState) => void } = {},
): Promise<SpeechState> {
  const onState = opts.onState || (() => {});
  stopSpeech();
  const чистый = String(text || '').trim();
  const preferredLanguage = opts.language || (typeof navigator !== 'undefined' ? navigator.language : '') || 'ru-RU';
  if (!чистый) return 'error';

  try {
    const r = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: чистый, gender: opts.gender || 'female', language: preferredLanguage }),
    });
    const тип = String(r.headers.get('content-type') || '');
    if (r.ok && /audio\//.test(тип)) {
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const звук = new Audio(url);
      звук.preload = 'auto';
      текущий = звук;
      const конец = () => {
        if (текущий === звук) текущий = null;
        URL.revokeObjectURL(url);
        onState('end');
      };
      звук.onended = конец;
      звук.onerror = конец;
      onState('play');
      await звук.play().catch(() => { /* браузер ждёт касания — считаем, что не играет */ });
      return 'play';
    }
  } catch { /* сервер недоступен — ниже откатываемся на устройство */ }

  /* Откат: речь устройства. Текст для неё берём у движка, чтобы формулы и
     разметку читала та же логика, что и в серверном голосе. */
  let речь = '';
  let language = preferredLanguage;
  try {
    const form = await speechForm(чистый, preferredLanguage);
    речь = form.speech;
    language = form.language || language;
  } catch { /* сервер молчит и здесь */ }
  if (!речь) речь = чистый.replace(/```[\s\S]*?```/g, ' Пример кода. ').replace(/[*_#`]/g, '').trim();
  let итог: SpeechState = 'error';
  speakDevice(речь, language, (s) => { итог = s; onState(s); });
  return итог;
}
