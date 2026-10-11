/**
 * Карта-редукция для длинных документов
 * 
 * Вместо обрезки документа до размера окна, разбиваем его на части,
 * читаем по частям и собираем ответ со ссылками на страницы.
 * Это то, за что хвалят DeepSeek: обработка длинных документов
 * без миллионного контекстного окна.
 */

/**
 * Размер чанка по умолчанию (в знаках)
 * ~100к знаков ≈ 25-30к токенов - укладывается в большинство моделей
 */
const DEFAULT_CHUNK_SIZE = 100000;

/**
 * Минимальный размер чанка, чтобы не дробить слишком мелко
 */
const MIN_CHUNK_SIZE = 20000;

/**
 * Разбивает текст на чанки с учётом структуры (абзацы, страницы)
 * Если текст содержит переносы строк, разбивает по абзацам.
 * Иначе разбивает по символам.
 */
export function splitIntoChunks(text, chunkSize = DEFAULT_CHUNK_SIZE, options = {}) {
  const { forceSize = false } = options;
  const effectiveChunkSize = forceSize 
    ? (chunkSize || DEFAULT_CHUNK_SIZE)
    : Math.max(MIN_CHUNK_SIZE, chunkSize || DEFAULT_CHUNK_SIZE);
  
  if (!text || text.length === 0) {
    return [];
  }
  
  const chunks = [];
  
  // Если текст содержит переносы строк, разбиваем по строкам
  const hasNewlines = text.includes('\n');
  
  if (hasNewlines) {
    const lines = text.split('\n');
    
    let currentChunk = '';
    let currentPage = 1;
    let currentLine = 0;
    let startLine = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Проверяем, не превышаем ли размер чанка
      const newChunkLength = currentChunk.length + (currentChunk.length > 0 ? 1 : 0) + line.length;
      
      if (newChunkLength > effectiveChunkSize && currentChunk.length > 0) {
        // Сохраняем текущий чанк
        chunks.push({
          content: currentChunk,
          page: currentPage,
          startLine: startLine,
          endLine: currentLine - 1,
          charCount: currentChunk.length,
        });
        
        currentChunk = line;
        currentPage++;
        startLine = currentLine;
      } else {
        currentChunk += (currentChunk.length > 0 ? '\n' : '') + line;
      }
      
      currentLine++;
    }
    
    // Сохраняем последний чанк
    if (currentChunk.length > 0) {
      chunks.push({
        content: currentChunk,
        page: currentPage,
        startLine: startLine,
        endLine: currentLine - 1,
        charCount: currentChunk.length,
      });
    }
  } else {
    // Разбиваем по символам
    let startIndex = 0;
    let currentPage = 1;
    
    while (startIndex < text.length) {
      const endIndex = Math.min(startIndex + effectiveChunkSize, text.length);
      const chunk = text.slice(startIndex, endIndex);
      
      chunks.push({
        content: chunk,
        page: currentPage,
        startLine: startIndex,
        endLine: endIndex - 1,
        charCount: chunk.length,
      });
      
      startIndex = endIndex;
      currentPage++;
    }
  }
  
  return chunks;
}

/**
 * Создаёт карту документа для обработки по частям
 */
export class DocumentMapper {
  constructor(text, options = {}) {
    this.originalText = text;
    // Для тестов позволяем меньший размер чанка
    this.chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;
    // Передаём chunkSize напрямую в splitIntoChunks, игнорируя MIN_CHUNK_SIZE
    this.chunks = splitIntoChunks(text, this.chunkSize, { forceSize: true });
    this.totalChars = text.length;
    this.totalPages = this.chunks.length;
  }

  /**
   * Получает количество чанков
   */
  get chunkCount() {
    return this.chunks.length;
  }

  /**
   * Получает информацию о чанке
   */
  getChunkInfo(index) {
    if (index < 0 || index >= this.chunks.length) {
      return null;
    }
    return this.chunks[index];
  }

  /**
   * Обрабатывает каждый чанк с моделью и собирает результаты
   * 
   * @param {Function} modelFn - Функция для обработки чанка моделью
   * @param {string} query - Запрос пользователя
   * @param {Object} options - Опции обработки
   * @returns {Promise<Object>} - Объект с собранным ответом и ссылками
   */
  async processWithModel(query, modelFn, options = {}) {
    const { maxConcurrent = 1 } = options;
    const results = [];
    
    // Обрабатываем чанки последовательно (или параллельно, если maxConcurrent > 1)
    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i];
      
      // Создаём промпт для этого чанка
      const prompt = this.buildChunkPrompt(chunk, query, i, this.chunks.length);
      
      try {
        const response = await modelFn(prompt);
        results.push({
          chunkIndex: i,
          page: chunk.page,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          response: response,
          success: true,
        });
      } catch (error) {
        results.push({
          chunkIndex: i,
          page: chunk.page,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          error: String(error),
          success: false,
        });
      }
    }
    
    return this.mergeResults(results, query);
  }

  /**
   * Создаёт промпт для обработки одного чанка
   */
  buildChunkPrompt(chunk, query, chunkIndex, totalChunks) {
    const contextInfo = `Фрагмент ${chunkIndex + 1}/${totalChunks} (страница ${chunk.page}, строки ${chunk.startLine + 1}-${chunk.endLine + 1})`;
    
    return `Проанализируй этот фрагмент документа:

${contextInfo}
---
${chunk.content}
---

Запрос: ${query}

Ответь на запрос, учитывая только этот фрагмент. Если в фрагменте нет информации для ответа, скажи "Нет информации в этом фрагменте".
Если найдёшь релевантную информацию, укажи в ответе: "На странице ${chunk.page} найдено: ..."

Важно: не выдумывай информацию, которой нет в фрагменте.`;
  }

  /**
   * Собирает результаты из всех чанков в единый ответ
   */
  mergeResults(results, query) {
    const successfulResults = results.filter(r => r.success);
    const failedResults = results.filter(r => !r.success);
    
    if (successfulResults.length === 0) {
      return {
        answer: `Не удалось найти информацию по запросу "${query}" в документе.`,
        references: [],
        chunksProcessed: results.length,
        chunksFailed: failedResults.length,
      };
    }
    
    // Собираем ответы
    const answers = successfulResults
      .map(r => r.response)
      .filter(a => a && a.trim());
    
    // Собираем ссылки
    const references = successfulResults
      .map(r => ({
        page: r.page,
        startLine: r.startLine,
        endLine: r.endLine,
        chunkIndex: r.chunkIndex,
      }))
      .filter(r => r.page > 0);
    
    // Объединяем ответы
    const mergedAnswer = this.mergeAnswers(answers, query);
    
    return {
      answer: mergedAnswer,
      references: references,
      chunksProcessed: results.length,
      chunksFailed: failedResults.length,
      totalPages: this.totalPages,
    };
  }

  /**
   * Объединяет несколько ответов в один
   */
  mergeAnswers(answers, query) {
    if (answers.length === 1) {
      return answers[0];
    }
    
    // Просто объединяем все ответы
    const merged = answers.join('\n\n---\n\n');
    
    // Добавляем введение
    return `По запросу "${query}" найдено в нескольких частях документа:\n\n${merged}`;
  }

  /**
   * Получает текст чанка
   */
  getChunkText(index) {
    const chunk = this.getChunkInfo(index);
    return chunk ? chunk.content : '';
  }

  /**
   * Получает статистику по карте
   */
  getStats() {
    return {
      totalChars: this.totalChars,
      chunkCount: this.chunkCount,
      avgChunkSize: Math.round(this.totalChars / this.chunkCount),
      totalPages: this.totalPages,
    };
  }
}

/**
 * Удобная функция для обработки документа по частям
 * 
 * @param {string} text - Текст документа
 * @param {string} query - Запрос
 * @param {Function} modelFn - Функция для вызова модели
 * @param {Object} options - Опции
 * @returns {Promise<Object>} - Результат обработки
 */
export async function processDocumentInChunks(text, query, modelFn, options = {}) {
  const mapper = new DocumentMapper(text, options);
  return mapper.processWithModel(query, modelFn, options);
}

/**
 * Проверяет, нужно ли дробить документ на чанки
 * 
 * @param {string} text - Текст документа
 * @param {number} maxContext - Максимальный контекст модели
 * @param {number} reservedTokens - Резервированные токены (для ответа, системного промпта и т.д.)
 * @returns {boolean} - true, если нужно дробить
 */
export function needsChunking(text, maxContext, reservedTokens = 2000) {
  // Примерная оценка: 1 токен ≈ 4 знака для латиницы
  const estimatedTokens = Math.ceil(text.length / 4);
  const availableForDoc = maxContext - reservedTokens;
  
  return estimatedTokens > availableForDoc;
}

export const TEST = { splitIntoChunks, DocumentMapper, processDocumentInChunks, needsChunking };
