/**
 * Озвучка ответов на стороне человека.
 *
 * Порядок такой: сначала пробуем серверный голос (POST /api/tts) — он звучит
 * живой речью. Если сервер не смог (служба голоса молчит, связи нет, потолок
 * частоты) — читаем речью самого устройства (речевой движок телефона). Речь
 * устройства не требует ничего, кроме установленного русского голоса, и потому
 * служит честным запасным путём: без неё кнопка «озвучить» превратилась бы в
 * обещание, которое не выполняется.
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

/** Есть ли на устройстве русский голос: без него запасной путь молчит. */
export function deviceVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const голоса = window.speechSynthesis.getVoices();
  if (!голоса.length) return null;
  return голоса.find((g) => /^ru/i.test(g.lang)) || голоса.find((g) => /ru/i.test(g.lang)) || null;
}

/** Речь устройства: говорим подготовленный текст. */
function speakDevice(speech: string, onState: (s: SpeechState) => void): void {
  const голос = deviceVoice();
  if (!голос) { onState('нет голоса'); return; }
  const u = new SpeechSynthesisUtterance(speech);
  u.voice = голос;
  u.lang = голос.lang;
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
async function speechForm(text: string): Promise<string> {
  const r = await fetch('/api/tts?text=1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const j = await r.json().catch(() => null);
  return (j && j.ok && j.speech) ? j.speech : '';
}

/**
 * Озвучить текст. Возвращает причину, если не вышло (её показываем подписью в
 * кнопке), и зовёт onState на каждом переходе — по нему рисуется «играет».
 */
export async function speak(
  text: string,
  opts: { gender?: 'male' | 'female'; onState?: (s: SpeechState) => void } = {},
): Promise<SpeechState> {
  const onState = opts.onState || (() => {});
  stopSpeech();
  const чистый = String(text || '').trim();
  if (!чистый) return 'error';

  try {
    const r = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: чистый, gender: opts.gender || 'female' }),
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
  try { речь = await speechForm(чистый); } catch { /* сервер молчит и здесь */ }
  if (!речь) речь = чистый.replace(/```[\s\S]*?```/g, ' Пример кода. ').replace(/[*_#`]/g, '').trim();
  let итог: SpeechState = 'error';
  speakDevice(речь, (s) => { итог = s; onState(s); });
  return итог;
}
