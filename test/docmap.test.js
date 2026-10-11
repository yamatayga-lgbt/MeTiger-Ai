/**
 * Тесты для engine/docmap.js - карта-редукция длинных документов
 */

import * as assert from 'node:assert';
import * as docmap from '../engine/docmap.js';

const { splitIntoChunks, DocumentMapper, processDocumentInChunks, needsChunking, TEST } = docmap;

// Простые тесты splitIntoChunks
console.log('=== Тесты splitIntoChunks ===');

// Тест 1: Разбивка простого текста
const simpleText = 'АБВГДЕ '.repeat(10000); // ~70000 знаков
const chunks1 = splitIntoChunks(simpleText, 25000);
assert.ok(chunks1.length > 1, 'Должно быть несколько чанков');
assert.ok(chunks1[0].content.length <= 25000, 'Первый чанк не должен превышать размер');
console.log('✓ Тест 1: Разбивка простого текста');

// Тест 2: Разбивка с учётом строк
const textWithLines = 'Строка 1\nСтрока 2\nСтрока 3\n'.repeat(1000);
const chunks2 = splitIntoChunks(textWithLines, 25000);
assert.ok(chunks2.length > 1, 'Должно быть несколько чанков');
console.log('✓ Тест 2: Разбивка с учётом строк');

// Тест 3: Маленький текст не разбивается
const smallText = 'Маленький текст';
const chunks3 = splitIntoChunks(smallText, 1000);
assert.strictEqual(chunks3.length, 1, 'Маленький текст не должен разбиваться');
console.log('✓ Тест 3: Маленький текст не разбивается');

// Тесты DocumentMapper
console.log('\n=== Тесты DocumentMapper ===');

// Тест 4: Создание карты документа
const testText = 'Фрагмент 1\n\nФрагмент 2\n\nФрагмент 3\n\n'.repeat(1000);
const mapper = new DocumentMapper(testText, { chunkSize: 25000 });
assert.ok(mapper.chunkCount > 1, 'Должно быть несколько чанков');
assert.strictEqual(mapper.originalText, testText, 'Оригинальный текст должен сохраняться');
console.log('✓ Тест 4: Создание карты документа');

// Тест 5: Получение информации о чанке
const chunkInfo = mapper.getChunkInfo(0);
assert.ok(chunkInfo, 'Должна возвращаться информация о чанке');
assert.ok(chunkInfo.page > 0, 'Номер страницы должен быть положительным');
console.log('✓ Тест 5: Получение информации о чанке');

// Тест 6: Получение текста чанка
const chunkText = mapper.getChunkText(0);
assert.ok(chunkText.length > 0, 'Текст чанка не должен быть пустым');
console.log('✓ Тест 6: Получение текста чанка');

// Тест 7: Статистика карты
const stats = mapper.getStats();
assert.ok(stats.totalChars > 0, 'Общее количество знаков должно быть положительным');
assert.ok(stats.chunkCount > 0, 'Количество чанков должно быть положительным');
console.log('✓ Тест 7: Статистика карты');

// Тесты needsChunking
console.log('\n=== Тесты needsChunking ===');

// Тест 8: Документ влезает в контекст
const smallDoc = 'Маленький документ';
assert.strictEqual(needsChunking(smallDoc, 100000, 2000), false, 'Маленький документ не должен дробиться');
console.log('✓ Тест 8: Маленький документ не дробится');

// Тест 9: Документ не влезает в контекст
const largeDoc = 'Очень большой документ '.repeat(10000);
assert.strictEqual(needsChunking(largeDoc, 1000, 2000), true, 'Большой документ должен дробиться');
console.log('✓ Тест 9: Большой документ дробится');

// Тесты buildChunkPrompt
console.log('\n=== Тесты buildChunkPrompt ===');

// Тест 10: Создание промпта для чанка
const testMapper = new DocumentMapper('Тестовый текст для промпта', { chunkSize: 100 });
const chunk = testMapper.getChunkInfo(0);
const prompt = testMapper.buildChunkPrompt(chunk, 'Что в тексте?', 0, 1);
assert.ok(prompt.includes('Фрагмент 1/1'), 'Промпт должен содержать информацию о фрагменте');
assert.ok(prompt.includes('Что в тексте?'), 'Промпт должен содержать запрос');
assert.ok(prompt.includes('Тестовый текст'), 'Промпт должен содержать текст чанка');
console.log('✓ Тест 10: Создание промпта для чанка');

// Тесты mergeResults
console.log('\n=== Тесты mergeResults ===');

// Тест 11: Слияние результатов
const mockResults = [
  {
    chunkIndex: 0,
    page: 1,
    startLine: 0,
    endLine: 10,
    response: 'Ответ из первого чанка',
    success: true,
  },
  {
    chunkIndex: 1,
    page: 2,
    startLine: 11,
    endLine: 20,
    response: 'Ответ из второго чанка',
    success: true,
  },
];
const merged = testMapper.mergeResults(mockResults, 'Тестовый запрос');
assert.ok(merged.answer, 'Должен быть ответ');
assert.strictEqual(merged.references.length, 2, 'Должны быть ссылки на оба чанка');
assert.strictEqual(merged.chunksProcessed, 2, 'Должно быть указано количество обработанных чанков');
console.log('✓ Тест 11: Слияние результатов');

// Тест 12: Слияние с ошибками
const mockResultsWithErrors = [
  {
    chunkIndex: 0,
    page: 1,
    startLine: 0,
    endLine: 10,
    response: 'Ответ из первого чанка',
    success: true,
  },
  {
    chunkIndex: 1,
    page: 2,
    startLine: 11,
    endLine: 20,
    error: 'Ошибка обработки',
    success: false,
  },
];
const mergedWithErrors = testMapper.mergeResults(mockResultsWithErrors, 'Тестовый запрос');
assert.ok(mergedWithErrors.answer, 'Должен быть ответ');
assert.strictEqual(mergedWithErrors.chunksFailed, 1, 'Должно быть указано количество неудачных чанков');
console.log('✓ Тест 12: Слияние с ошибками');

// Тест 13: Все чанки неудачны
const allFailedResults = [
  {
    chunkIndex: 0,
    page: 1,
    startLine: 0,
    endLine: 10,
    error: 'Ошибка',
    success: false,
  },
];
const allFailed = testMapper.mergeResults(allFailedResults, 'Тестовый запрос');
assert.ok(allFailed.answer.includes('Не удалось найти'), 'Должно быть сообщение об отсутствии информации');
console.log('✓ Тест 13: Все чанки неудачны');

// Тесты по умолчанию
console.log('\n=== Тесты значений по умолчанию ===');

// Тест 14: Размер чанка по умолчанию
const defaultMapper = new DocumentMapper('Тест', {});
assert.strictEqual(defaultMapper.chunkSize, 100000, 'Размер чанка по умолчанию должен быть 100000');
console.log('✓ Тест 14: Размер чанка по умолчанию');

// Тест 15: Минимальный размер чанка (без forceSize)
const minMapper = new DocumentMapper('Тест', {});
assert.strictEqual(minMapper.chunkSize, 100000, 'Размер чанка по умолчанию должен быть 100000');
console.log('✓ Тест 15: Размер чанка по умолчанию');

// Экспорт для проверки в других тестах
if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, { docmap: { splitIntoChunks, DocumentMapper, processDocumentInChunks, needsChunking } });
}

console.log('\n✅ Все тесты docmap пройдены!');
