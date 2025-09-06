const axios = require('axios');
const path = require('path');
const { saveRejectedGrant } = require('../lib/db');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const CONFIG = {
  MAX_TEXT_LENGTH: 10000,
  RETRY_COUNT: 3,
  RETRY_DELAY: 1000,
  TEMPERATURE: 1,
  MODEL: 'gpt-5-mini'
};

const categories = [
  'Освіта',
  'Стартапи',
  'Підтримка ветеранів',
  'Навчання підприємництву',
  'Вища освіта у менеджменті',
  'Корпоративне навчання',
  'Навчання жінок',
  'Лідерство та резильєнтність',
  'Фінанси та інвестиції',
  'Управління персоналом',
  'Інвестиційні проєкти'
];

const keywords = {
  'Освіта': [
    'higher education funding', 'education grants', 'capacity building', 'professional development', 'business education', 'executive education',
    'фінансування вищої освіти', 'освітні гранти', 'нарощування потенціалу', 'професійний розвиток', 'бізнес-освіта', 'управлінська освіта'
  ],
  'Стартапи': [
    'startup grants', 'business acceleration', 'business incubation', 'incubator', 'innovations', 'incubator funding',
    'гранти для стартапів', 'бізнес-акселерація', 'бізнес-інкубація', 'інкубатор', 'інновації', 'фінансування інкубаторів'
  ],
  'Підтримка ветеранів': [
    'veteran entrepreneurship', 'veteran education', 'veteran business grants', 'reintegration programs',
    'підприємництво ветеранів', 'освіта для ветеранів', 'бізнес-гранти для ветеранів', 'програми реінтеграції'
  ],
  'Навчання підприємництву': [
    'entrepreneurship training', 'SME support', 'business incubation', 'business resilience programs',
    'тренінги з підприємництва', 'підтримка МСП', 'бізнес-інкубація', 'програми бізнес-резильєнтності'
  ],
  'Вища освіта у менеджменті': [
    'management education', 'business school funding', 'research grants in management', 'doctoral education funding', 'MBA', 'DBA',
    'освіта в галузі менеджменту', 'фінансування бізнес-шкіл', 'гранти на дослідження у сфері менеджменту', 'фінансування докторських програм', 'MBA', 'DBA'
  ],
  'Корпоративне навчання': [
    'corporate training', 'workforce upskilling', 'lifelong learning', 'l&d',
    'корпоративне навчання', 'підвищення кваліфікації працівників', 'навчання впродовж життя', 'навчання та розвиток (L&D)'
  ],
  'Навчання жінок': [
    'women entrepreneurship', 'women leadership programs', 'gender equity in business',
    'жіноче підприємництво', 'програми жіночого лідерства', 'гендерна рівність у бізнесі'
  ],
  'Лідерство та резильєнтність': [
    'leadership development', 'resilience training', 'adaptive leadership programs', 'business leadership', 'business resilience',
    'розвиток лідерства', 'тренінги з резильєнтності', 'адаптивне лідерство', 'бізнес-лідерство', 'стійкість бізнесу'
  ],
  'Фінанси та інвестиції': [
    'financial literacy programs', 'investment readiness', 'impact investment', 'economic empowerment',
    'програми фінансової грамотності', 'готовність до інвестування', 'впливові інвестиції', 'економічне розширення можливостей'
  ],
  'Управління персоналом': [
    'human capital development', 'HR management training', 'talent management grants',
    'розвиток людського капіталу', 'навчання з управління персоналом', 'гранти на управління талантами'
  ],
  'Інвестиційні проєкти': [
    'investment funding', 'business scaling grants', 'international cooperation in finance',
    'фінансування інвестицій', 'гранти на масштабування бізнесу', 'міжнародне співробітництво у фінансах'
  ]
};

async function extractGrantInfo(text, url) {
  console.log(`🤖 [RECOMMENDATION ENGINE] Starting AI analysis for URL: ${url}`);
  
  // Validate inputs
  if (!text || text.trim().length < 50) {
    console.warn(`❌ [RECOMMENDATION ENGINE] Insufficient text content for URL: ${url} (length: ${text?.length || 0})`);
    return null;
  }

  console.log(`📄 [RECOMMENDATION ENGINE] Processing text content (length: ${text.length} characters)`);
  
  // Truncate text if too long
  const truncatedText = text.length > CONFIG.MAX_TEXT_LENGTH
    ? text.substring(0, CONFIG.MAX_TEXT_LENGTH) + '...'
    : text;
    
  if (text.length > CONFIG.MAX_TEXT_LENGTH) {
    console.log(`✂️ [RECOMMENDATION ENGINE] Text truncated from ${text.length} to ${CONFIG.MAX_TEXT_LENGTH} characters`);
  }


  console.log(`🎯 [RECOMMENDATION ENGINE] Preparing AI prompt with materials:`);
  console.log(`   • Available categories: ${categories.length} (${categories.join(', ')})`);
  console.log(`   • Keyword sets: ${Object.keys(keywords).length} category groups`);
  console.log(`   • Filtering criteria: grants <20k$, SME/small business, student scholarships`);
  console.log(`   • AI Model: ${CONFIG.MODEL}, Temperature: ${CONFIG.TEMPERATURE}`);

  const prompt = `
Витягни з тексту:
- title: назва
- deadline: DD-MM-YYYY або null
- category: одна з ${categories.join(', ')}

Встанови null крім title, якщо:
- Грант <20k$
- Для МСП/малого бізнесу
- Стипендії для учнів

Потрібні гранти, які цікавлять великі компанії.

JSON: {"title": "назва", "deadline": "31-12-2024", "category": "категорія"}

Текст: "${truncatedText}"
`;

  console.log(`📤 [RECOMMENDATION ENGINE] Sending analysis request to OpenAI...`);

// Ключові слова для категорій (використовуються AI для кращого розуміння контексту):
// Ці ключові слова допомагають AI моделі краще розуміти які гранти відносити до кожної категорії
// ${JSON.stringify(keywords, null, 2)}

  let attempt = 0;
  while (attempt < CONFIG.RETRY_COUNT) {
    try {
      console.log(`🔄 [RECOMMENDATION ENGINE] Attempt ${attempt + 1}/${CONFIG.RETRY_COUNT} for URL: ${url}`);
      
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: CONFIG.MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: CONFIG.TEMPERATURE,
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
          // 'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 seconds timeout
      });

      console.log(`📥 [RECOMMENDATION ENGINE] Received response from OpenAI for URL: ${url}`);
      
      let content = response.data.choices[0].message.content;
      console.log(`🔧 [RECOMMENDATION ENGINE] Raw AI response: ${content.substring(0, 200)}...`);

      // Remove markdown code blocks if present
      content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

      const result = JSON.parse(content);
      console.log(`✅ [RECOMMENDATION ENGINE] Parsed recommendation result:`, {
        title: result.title,
        deadline: result.deadline,
        category: result.category,
        url: url
      });

      // Validate result structure
      if (!result.title || typeof result.title !== 'string') {
        throw new Error('Invalid response: missing or invalid title');
      }

      if (result.category === null) {
        console.log(`🚫 [RECOMMENDATION ENGINE] Grant "${result.title}" from ${url} filtered out - no matching category (likely <20k$, SME, or student scholarship)`);
        // Save to rejected grants table to avoid reprocessing
        await saveRejectedGrant(url, result.title, 'no_matching_category', text.substring(0, 1000));
        return null;
      }

      console.log(`🎉 [RECOMMENDATION ENGINE] Successfully categorized grant: "${result.title}" → ${result.category}`);
      return { ...result, url };

    } catch (error) {
      attempt++;
      const isLastAttempt = attempt >= CONFIG.RETRY_COUNT;

      console.log(`❌ [RECOMMENDATION ENGINE] Error on attempt ${attempt}/${CONFIG.RETRY_COUNT} for ${url}: ${error.message}`);

      if (error.response?.status === 429) {
        // Rate limit error - wait longer
        const waitTime = CONFIG.RETRY_DELAY * attempt * 2;
        console.warn(`⏳ [RECOMMENDATION ENGINE] Rate limited for ${url}, retrying in ${waitTime}ms (attempt ${attempt}/${CONFIG.RETRY_COUNT})`);
        if (!isLastAttempt) {
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
      }

      if (isLastAttempt) {
        const errorMessage = error.response?.data?.error?.message || error.message;
        console.error(`💥 [RECOMMENDATION ENGINE] Failed to extract grant info from ${url} after ${CONFIG.RETRY_COUNT} attempts:`, errorMessage);

        // Save to rejected grants table to avoid reprocessing
        await saveRejectedGrant(url, null, `extraction_failed: ${errorMessage}`, text.substring(0, 1000));
        return null;
      }

      // Wait before retry
      console.log(`⏳ [RECOMMENDATION ENGINE] Waiting ${CONFIG.RETRY_DELAY * attempt}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY * attempt));
    }
  }

  console.log(`💥 [RECOMMENDATION ENGINE] All attempts exhausted for URL: ${url}`);
  return null;
}

/**
 * Get recommendation engine configuration for documentation and debugging
 * @returns {Object} Configuration details
 */
function getRecommendationConfig() {
  return {
    model: CONFIG.MODEL,
    temperature: CONFIG.TEMPERATURE,
    maxTextLength: CONFIG.MAX_TEXT_LENGTH,
    retryCount: CONFIG.RETRY_COUNT,
    categories: categories,
    keywordGroups: Object.keys(keywords).length,
    keywords: keywords,
    filteringCriteria: [
      'Гранти менше $20,000',
      'Для МСП/малого бізнесу', 
      'Стипендії для учнів',
      'Прострочені або скоро закінчуються (<10 днів)'
    ]
  };
}

/**
 * Log detailed recommendation engine status
 */
function logRecommendationEngineStatus() {
  const config = getRecommendationConfig();
  console.log('🤖 [RECOMMENDATION ENGINE] Configuration:');
  console.log(`   • AI Model: ${config.model}`);
  console.log(`   • Temperature: ${config.temperature}`);
  console.log(`   • Max text length: ${config.maxTextLength} characters`);
  console.log(`   • Available categories: ${config.categories.length}`);
  console.log(`   • Keyword groups: ${config.keywordGroups}`);
  console.log(`   • Filtering criteria: ${config.filteringCriteria.length} rules`);
}

module.exports = { 
  extractGrantInfo, 
  getRecommendationConfig, 
  logRecommendationEngineStatus 
};
