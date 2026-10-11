/**
 * Умная память чата
 * 
 * Вместо обрезки старых реплик, сжимаем их в конспект.
 * Это позволяет сохранить контекст разговора при работе с длинными диалогами.
 */

import { estTokens } from './ctxfit.js';

/**
 * Минимальное количество реплик для сжатия
 */
const MIN_MESSAGES_FOR_COMPRESSION = 5;

/**
 * Максимальный размер конспекта в токенах
 */
const MAX_SUMMARY_TOKENS = 2000;

/**
 * Максимальный размер конспекта в знаках
 */
const MAX_SUMMARY_CHARS = 5000;

/**
 * Минимальное количество токенов для сжатия
 */
const MIN_TOKENS_FOR_COMPRESSION = 4000;

/**
 * Класс для управления умной памятью чата
 */
export class SmartChatMemory {
  constructor(options = {}) {
    this.maxTokens = options.maxTokens || 32000;
    this.messages = options.messages || [];
    this.summary = options.summary || null;
    this.compressionEnabled = options.compressionEnabled !== false;
    this.compressionThreshold = options.compressionThreshold || MIN_TOKENS_FOR_COMPRESSION;
  }

  /**
   * Добавляет сообщение в память
   * 
   * @param {Object} message - Сообщение для добавления
   * @param {Object} options - Опции
   * @returns {Object} - Информация о сжатии
   */
  addMessage(message, options = {}) {
    const { forceCompress = false } = options;
    const messageTokens = estTokens(message.content || message.text || '');
    const currentTotal = this.getTotalTokens();
    
    // Если есть место - просто добавляем
    if (currentTotal + messageTokens <= this.maxTokens) {
      this.messages.push(message);
      return { compressed: false, summaryAdded: false };
    }
    
    // Пробуем сжать, если включено сжатие
    if (this.compressionEnabled) {
      const compressionResult = this.tryCompressAndAdd(message);
      if (compressionResult.success) {
        return { compressed: true, summaryAdded: compressionResult.summaryAdded };
      }
    }
    
    // Если сжатие не помогло или отключено - режем старые сообщения
    this.trimOldMessages(messageTokens);
    this.messages.push(message);
    
    return { compressed: false, summaryAdded: false, trimmed: true };
  }

  /**
   * Пробует сжать старые сообщения и добавить новое
   */
  tryCompressAndAdd(newMessage) {
    // Сжимаем старые сообщения, если их достаточно
    if (this.messages.length >= MIN_MESSAGES_FOR_COMPRESSION) {
      const compressionResult = this.compressOldMessages();
      
      if (compressionResult.success) {
        // Пробуем добавить новое сообщение
        const newMessageTokens = estTokens(newMessage.content || newMessage.text || '');
        const currentTotal = this.getTotalTokens();
        
        if (currentTotal + newMessageTokens <= this.maxTokens) {
          this.messages.push(newMessage);
          return { success: true, summaryAdded: compressionResult.summaryAdded };
        }
      }
    }
    
    // Если сжатие не помогло или мало сообщений - пробуем сжать всё, что есть
    if (this.messages.length >= 2) {
      const compressionResult = this.compressOldMessages();
      if (compressionResult.success) {
        const newMessageTokens = estTokens(newMessage.content || newMessage.text || '');
        const currentTotal = this.getTotalTokens();
        
        if (currentTotal + newMessageTokens <= this.maxTokens) {
          this.messages.push(newMessage);
          return { success: true, summaryAdded: compressionResult.summaryAdded };
        }
      }
    }
    
    return { success: false };
  }

  /**
   * Сжимает старые сообщения в конспект
   * 
   * @returns {Object} - Результат сжатия
   */
  compressOldMessages() {
    // Если уже есть конспект и он большой - не сжимаем
    if (this.summary && estTokens(this.summary) >= MAX_SUMMARY_TOKENS) {
      return { success: false, summaryAdded: false };
    }
    
    // Берём старые сообщения для сжатия
    // Если мало сообщений - сжимаем все, кроме последнего
    const messagesToCompress = this.messages.length >= MIN_MESSAGES_FOR_COMPRESSION
      ? this.messages.slice(0, Math.floor(this.messages.length / 2))
      : this.messages.slice(0, this.messages.length - 1);
    
    const newMessages = this.messages.length >= MIN_MESSAGES_FOR_COMPRESSION
      ? this.messages.slice(Math.floor(this.messages.length / 2))
      : this.messages.slice(this.messages.length - 1);
    
    if (messagesToCompress.length < 1) {
      return { success: false, summaryAdded: false };
    }
    
    // Создаём конспект
    const summary = this.createSummary(messagesToCompress);
    
    if (!summary || summary.length === 0) {
      return { success: false, summaryAdded: false };
    }
    
    // Обновляем память
    this.summary = summary;
    this.messages = [
      {
        role: 'system',
        content: `[КОНСПЕКТ ПЕРЕПИСКИ]: ${summary}\n\n--- Далее актуальная часть ---`,
      },
      ...newMessages,
    ];
    
    return { success: true, summaryAdded: true, summary };
  }

  /**
   * Создаёт конспект из списка сообщений
   * 
   * @param {Array} messages - Сообщения для сжатия
   * @returns {string} - Конспект
   */
  createSummary(messages) {
    // Простой алгоритм: берём первые сообщения каждого участника
    // и объединяем их в краткое описание
    
    const summaries = [];
    
    for (const msg of messages) {
      const role = msg.role || (msg.text ? 'user' : 'assistant');
      const content = msg.content || msg.text || '';
      
      if (!content.trim()) continue;
      
      // Берём первые 100 знаков от каждого сообщения
      const preview = content.trim().slice(0, 100);
      summaries.push(`${role === 'assistant' ? 'Бот' : 'Человек'}: ${preview}...`);
    }
    
    if (summaries.length === 0) return '';
    
    // Объединяем и обрезаем до максимального размера
    let summary = summaries.join(' | ');
    
    if (summary.length > MAX_SUMMARY_CHARS) {
      summary = summary.slice(0, MAX_SUMMARY_CHARS) + '...';
    }
    
    return summary;
  }

  /**
   * Создаёт умный конспект с помощью модели
   * (Для будущей интеграции с LLM)
   * 
   * @param {Array} messages - Сообщения для сжатия
   * @param {Function} modelFn - Функция для вызова модели
   * @returns {Promise<string>} - Конспект
   */
  async createSmartSummary(messages, modelFn) {
    // Формируем промпт для сжатия
    const prompt = this.buildCompressionPrompt(messages);
    
    try {
      const response = await modelFn(prompt);
      return response;
    } catch (error) {
      // Если модель недоступна - используем простой конспект
      console.warn('Не удалось создать умный конспект:', error);
      return this.createSummary(messages);
    }
  }

  /**
   * Создаёт промпт для сжатия переписки
   */
  buildCompressionPrompt(messages) {
    const formattedMessages = messages
      .map((msg, i) => {
        const role = msg.role || (msg.text ? 'user' : 'assistant');
        const content = msg.content || msg.text || '';
        return `${i + 1}. ${role === 'assistant' ? 'Бот' : 'Человек'}: ${content.slice(0, 500)}`;
      })
      .join('\n');
    
    return `Сожми эту переписку в краткий конспект (макс. 5 предложений). 
Укажи основные темы и ключевые моменты:

${formattedMessages}

---

Конспект:`;
  }

  /**
   * Режет старые сообщения, если не хватает места
   */
  trimOldMessages(neededTokens) {
    const currentTotal = this.getTotalTokens();
    const available = this.maxTokens - neededTokens;
    
    if (currentTotal <= available) return;
    
    // Удаляем старые сообщения, пока не хватит места
    while (this.messages.length > 1 && this.getTotalTokens() > available) {
      this.messages.shift();
    }
    
    // Если всё равно не хватает - обрезаем первое сообщение
    if (this.getTotalTokens() > available && this.messages.length > 0) {
      const firstMsg = this.messages[0];
      const firstTokens = estTokens(firstMsg.content || firstMsg.text || '');
      const maxTokensForFirst = available - (this.getTotalTokens() - firstTokens);
      
      if (maxTokensForFirst > 0) {
        const maxChars = Math.floor(maxTokensForFirst * 4); // Примерно 4 знака на токен
        firstMsg.content = (firstMsg.content || firstMsg.text || '').slice(0, maxChars) + '...';
        firstMsg.text = firstMsg.content;
      }
    }
  }

  /**
   * Получает общее количество токенов в памяти
   */
  getTotalTokens() {
    let total = this.summary ? estTokens(this.summary) : 0;
    
    for (const msg of this.messages) {
      total += estTokens(msg.content || msg.text || '');
    }
    
    return total;
  }

  /**
   * Получает все сообщения (включая конспект)
   */
  getAllMessages() {
    const allMessages = [];
    
    if (this.summary) {
      allMessages.push({
        role: 'system',
        content: `[КОНСПЕКТ]: ${this.summary}`,
      });
    }
    
    return [...allMessages, ...this.messages];
  }

  /**
   * Получает статистику памяти
   */
  getStats() {
    return {
      messageCount: this.messages.length,
      totalTokens: this.getTotalTokens(),
      summaryTokens: this.summary ? estTokens(this.summary) : 0,
      compressionEnabled: this.compressionEnabled,
      hasSummary: !!this.summary,
    };
  }

  /**
   * Очищает память
   */
  clear() {
    this.messages = [];
    this.summary = null;
  }

  /**
   * Сбрасывает конспект
   */
  clearSummary() {
    this.summary = null;
  }
}

/**
 * Создаёт умную память чата
 * 
 * @param {Object} options - Опции
 * @returns {SmartChatMemory} - Экземпляр умной памяти
 */
export function createSmartMemory(options = {}) {
  return new SmartChatMemory(options);
}

/**
 * Проверяет, нужно ли сжимать память
 * 
 * @param {number} currentTokens - Текущее количество токенов
 * @param {number} maxTokens - Максимальное количество токенов
 * @returns {boolean} - true, если нужно сжимать
 */
export function shouldCompress(currentTokens, maxTokens) {
  return currentTokens >= maxTokens * 0.7; // Сжимаем при 70% заполнении
}

export const TEST = { SmartChatMemory, createSmartMemory, shouldCompress };
