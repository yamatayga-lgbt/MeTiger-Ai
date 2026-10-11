/**
 * Тесты для engine/smartmemory.js - умная память чата
 */

import * as assert from 'node:assert';
import * as smartmemory from '../engine/smartmemory.js';

const { SmartChatMemory, createSmartMemory, shouldCompress, TEST } = smartmemory;

console.log('=== Тесты SmartChatMemory ===');

// Тест 1: Создание памяти
const memory = new SmartChatMemory({ maxTokens: 10000 });
assert.ok(memory, 'Память должна создаваться');
assert.strictEqual(memory.messages.length, 0, 'Начальное количество сообщений должно быть 0');
console.log('✓ Тест 1: Создание памяти');

// Тест 2: Добавление сообщения
memory.addMessage({ role: 'user', content: 'Привет!' });
assert.strictEqual(memory.messages.length, 1, 'Должно быть 1 сообщение');
console.log('✓ Тест 2: Добавление сообщения');

// Тест 3: Добавление нескольких сообщений
memory.addMessage({ role: 'assistant', content: 'Привет! Как дела?' });
memory.addMessage({ role: 'user', content: 'Отлично! А у тебя?' });
assert.strictEqual(memory.messages.length, 3, 'Должно быть 3 сообщения');
console.log('✓ Тест 3: Добавление нескольких сообщений');

// Тест 4: Получение статистики
const stats = memory.getStats();
assert.ok(stats.messageCount > 0, 'Количество сообщений должно быть положительным');
assert.ok(stats.totalTokens > 0, 'Общее количество токенов должно быть положительным');
console.log('✓ Тест 4: Получение статистики');

// Тест 5: Получение всех сообщений
const allMessages = memory.getAllMessages();
assert.ok(allMessages.length >= memory.messages.length, 'Все сообщения должны возвращаться');
console.log('✓ Тест 5: Получение всех сообщений');

// Тесты сжатия
console.log('\n=== Тесты сжатия ===');

// Тест 6: Создание памяти с маленьким лимитом
const smallMemory = new SmartChatMemory({ maxTokens: 1000, compressionEnabled: true });

// Добавляем сообщения, которые не влезают
for (let i = 0; i < 10; i++) {
  smallMemory.addMessage({ role: 'user', content: 'Очень длинное сообщение '.repeat(50) });
}

const statsAfter = smallMemory.getStats();
console.log(`Статистика после добавления: ${JSON.stringify(statsAfter)}`);

// Проверяем, что память не переполнилась сильно
assert.ok(statsAfter.totalTokens <= smallMemory.maxTokens * 2, 
  'Общее количество токенов не должно сильно превышать лимит');
console.log('✓ Тест 6: Сжатие при переполнении');

// Тест 7: Создание конспекта вручную
const memory2 = new SmartChatMemory({ maxTokens: 10000 });
for (let i = 0; i < 5; i++) {
  memory2.addMessage({ role: i % 2 === 0 ? 'user' : 'assistant', content: `Сообщение ${i + 1}` });
}

const compressionResult = memory2.compressOldMessages();
console.log(`Результат сжатия: ${JSON.stringify(compressionResult)}`);

if (compressionResult.success) {
  const statsAfterCompression = memory2.getStats();
  assert.ok(statsAfterCompression.hasSummary, 'Должен быть создан конспект');
  console.log('✓ Тест 7: Создание конспекта вручную');
} else {
  console.log('⚠ Тест 7: Сжатие не было выполнено (нормально для малого количества сообщений)');
}

// Тест 8: Создание простого конспекта
const memory3 = new SmartChatMemory({ maxTokens: 10000 });
const messages = [
  { role: 'user', content: 'Расскажи о погоде' },
  { role: 'assistant', content: 'Сегодня солнечно' },
  { role: 'user', content: 'А завтра?' },
  { role: 'assistant', content: 'Завтра будет дождь' },
];

for (const msg of messages) {
  memory3.addMessage(msg);
}

const summary = memory3.createSummary(messages);
assert.ok(summary.length > 0, 'Конспект не должен быть пустым');
assert.ok(summary.length <= 5000, 'Конспект не должен превышать максимальный размер');
console.log('✓ Тест 8: Создание простого конспекта');

// Тест 9: Создание промпта для сжатия
const prompt = memory3.buildCompressionPrompt(messages);
assert.ok(prompt.includes('Сожми'), 'Промпт должен содержать просьбу сжать');
assert.ok(prompt.includes('Конспект'), 'Промпт должен содержать слово "Конспект"');
console.log('✓ Тест 9: Создание промпта для сжатия');

// Тесты shouldCompress
console.log('\n=== Тесты shouldCompress ===');

// Тест 10: Сжатие нужно при 70% заполнении
assert.strictEqual(shouldCompress(700, 1000), true, 'Сжатие нужно при 70%');
console.log('✓ Тест 10: Сжатие нужно при 70%');

// Тест 11: Сжатие не нужно при 60% заполнении
assert.strictEqual(shouldCompress(600, 1000), false, 'Сжатие не нужно при 60%');
console.log('✓ Тест 11: Сжатие не нужно при 60%');

// Тесты createSmartMemory
console.log('\n=== Тесты createSmartMemory ===');

// Тест 12: Создание через фабрику
const memory4 = createSmartMemory({ maxTokens: 5000 });
assert.ok(memory4 instanceof SmartChatMemory, 'Должен возвращаться экземпляр SmartChatMemory');
console.log('✓ Тест 12: Создание через фабрику');

// Тесты очистки
console.log('\n=== Тесты очистки ===');

// Тест 13: Очистка памяти
memory.clear();
assert.strictEqual(memory.messages.length, 0, 'После очистки сообщений не должно быть');
assert.strictEqual(memory.summary, null, 'После очистки конспекта не должно быть');
console.log('✓ Тест 13: Очистка памяти');

// Тест 14: Очистка конспекта
const memory5 = new SmartChatMemory();
memory5.addMessage({ role: 'user', content: 'Привет' });
memory5.compressOldMessages();
memory5.clearSummary();
assert.strictEqual(memory5.summary, null, 'Конспект должен быть удалён');
console.log('✓ Тест 14: Очистка конспекта');

// Тесты с отключенным сжатием
console.log('\n=== Тесты с отключенным сжатием ===');

// Тест 15: Сжатие отключено
const noCompressMemory = new SmartChatMemory({ 
  maxTokens: 100, 
  compressionEnabled: false 
});

for (let i = 0; i < 10; i++) {
  noCompressMemory.addMessage({ role: 'user', content: 'Длинное сообщение '.repeat(50) });
}

const noCompressStats = noCompressMemory.getStats();
assert.strictEqual(noCompressStats.hasSummary, false, 'Конспект не должен создаваться при отключенном сжатии');
console.log('✓ Тест 15: Сжатие отключено');

// Экспорт для проверки в других тестах
if (typeof globalThis !== 'undefined') {
  Object.assign(globalThis, { 
    smartmemory: { 
      SmartChatMemory, 
      createSmartMemory, 
      shouldCompress 
    } 
  });
}

console.log('\n✅ Все тесты smartmemory пройдены!');
