#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Порт attune из донора: вытаскиваем блоки буквально (чтобы регулярки не
разъехались), убираем только то, что в MeTiger не переносится без отдельного
слова владельца, и добавляем ESM-экспорты."""
import io, re, json

src = io.open('/home/user/yama-ai/attune.js', encoding='utf-8').read()


def top_level(name):
    """Тело функции/константы от объявления до закрывающей скобки нулевой глубины."""
    i = src.index(name)
    # идём до первого '{' или '['
    open_ch = None
    j = i
    while j < len(src):
        if src[j] in '{[':
            open_ch = src[j]
            break
        j += 1
    close = '}' if open_ch == '{' else ']'
    depth = 0
    k = j
    in_s = None
    while k < len(src):
        ch = src[k]
        if in_s:
            if ch == '\\':
                k += 2
                continue
            if ch == in_s:
                in_s = None
        elif ch in '\'"`':
            in_s = ch
        elif ch == open_ch:
            depth += 1
        elif ch == close:
            depth -= 1
            if depth == 0:
                return src[i:k + 1]
        k += 1
    raise SystemExit('не нашёл конец для ' + name)


# ---- GOALS: границы элементов ищем по началу элемента «{ key: '…» ----
goals_src = top_level('const GOALS = [')
arr = goals_src[goals_src.index('[') + 1:goals_src.rindex(']')]
starts = [m.start() for m in re.finditer(r"\{\s*key:\s*'", arr)] + [len(arr)]
kept = []
for n in range(len(starts) - 1):
    e = arr[starts[n]:starts[n + 1]].rstrip().rstrip(',').rstrip()
    if not e.endswith('}'):
        e += '}'
    if "key: 'scene'" in e:
        continue
    kept.append(e)
goals_js = 'const GOALS = [\n' + ',\n'.join('  ' + b.replace('\n', '\n  ') for b in kept) + '\n];'

shape_js = top_level('const SHAPE = [')
hit_js = re.search(r'const HIT = .*?;\n', src, re.S).group(0).rstrip()
miss_js = re.search(r'const MISS = .*?;\n', src, re.S).group(0).rstrip()
angry_js = re.search(r'const ANGRY = .*?;\n', src, re.S).group(0).rstrip()

funcs = {}
for fn in ['readIntent', 'readReaction', 'directivesFrom', 'buildAttunePrompt', 'goalByKey', 'words', 'jaccard', 'resolveIntent']:
    try:
        funcs[fn] = top_level('function ' + fn + '(')
    except SystemExit:
        funcs[fn] = None

# ---- то, что не переносим: персонаж, род, ориентация ----
persona = [l for l in funcs['buildAttunePrompt'].split('\n') if 'не под ориентацию' in l or 'тебя влечёт' in l]
print('строки персонажа, которые вырезаю:', len(persona))
clean = '\n'.join(l for l in funcs['buildAttunePrompt'].split('\n') if l not in persona)

out = '''/**
 * 🎯 Настройка на человека — порт `attune.js` из Yama AI (1.0.228).
 *
 * Три вещи, которых не хватало «умному ответу»:
 *   1) чего человек добивается ЭТИМ сообщением и этим диалогом (цель и ожидаемая
 *      форма) — чтобы не читать лекцию там, где надо просто сделать;
 *   2) попал ли прошлый ответ в ожидания — по его реакции (похвала, «не то»,
 *      «короче», повтор того же вопроса);
 *   3) накопление: поправки складываются в профиль чата и укрепляются повтором,
 *      поэтому следующий ответ ближе к человеку, чем предыдущий.
 *
 * Никаких моделей и сети: всё читается детерминированно и дёшево — работает и на
 * быстром пути, где ядро не думает.
 *
 * Чего из донора здесь НЕТ намеренно (переносится только по отдельному слову
 * владельца, см. ПЕРЕНОС.md): цели «сцена/флирт/18+» с директивами про возраст и
 * упоминания рода и ориентации агента в финальной строке промпта. Механика
 * (цели, форма, реакция, накопление) перенесена полностью — она к содержанию
 * персонажа отношения не имеет.
 */

/* Начало слова: \\b в JS не знает кириллицы, поэтому вместо границы слова —
   отрицательный осмотр: «да», но не «давай». */
'''

parts = [
    hit_js,
    miss_js,
    angry_js,
    '\n/* ==================== 1) Цель сообщения ====================\n   Порядок важен: первый сверху совпавший тип считается главным. */',
    goals_js,
    '\n/* Явные пожелания по форме — считаются прямо из текста и перекрывают догадку. */',
    shape_js,
    '\n/* ==================== 2) Реакция на прошлый ответ ==================== */',
    funcs['words'],
    funcs['jaccard'],
    funcs['readIntent'],
    funcs['readReaction'],
    '\n/* ==================== 3) Что из этого следует ==================== */',
    funcs['goalByKey'],
    funcs['resolveIntent'],
    funcs['directivesFrom'],
    '\n/** Блок в системный промпт: цель + проверенное про человека + что поправить сейчас. */',
    clean,
]
body = '\n\n'.join(p for p in parts if p)
# экспорты того, что зовут снаружи
for name in ['readIntent', 'readReaction', 'directivesFrom', 'buildAttunePrompt', 'resolveIntent', 'GOALS', 'SHAPE']:
    body = re.sub(r'\n(const ' + name + r' |function ' + name + r'\()', r'\nexport \1', '\n' + body).lstrip('\n')
io.open('/home/user/metiger/MeTiger-Ai/engine/attune.js', 'w', encoding='utf-8').write(body + '\n')
print('engine/attune.js записан,', len(body.split(chr(10))), 'строк')
