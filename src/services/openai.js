const axios = require('axios');
const path = require('path');
const { saveRejectedGrant } = require('../lib/db');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const CONFIG = {
  MAX_TEXT_LENGTH: 50000,
  RETRY_COUNT: 3,
  RETRY_DELAY: 1000,
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
  'Інвестиційні проєкти',
  'Партнерські можливості',
  'Вища освіта/MBA/PhD'
];

// const keywords = {
//   'Освіта': [
//     'higher education funding', 'education grants', 'capacity building', 'professional development', 'business education', 'executive education',
//     'фінансування вищої освіти', 'освітні гранти', 'нарощування потенціалу', 'професійний розвиток', 'бізнес-освіта', 'управлінська освіта'
//   ],
//   'Стартапи': [
//     'startup grants', 'business acceleration', 'business incubation', 'incubator', 'innovations', 'incubator funding',
//     'гранти для стартапів', 'бізнес-акселерація', 'бізнес-інкубація', 'інкубатор', 'інновації', 'фінансування інкубаторів'
//   ],
//   'Підтримка ветеранів': [
//     'veteran entrepreneurship', 'veteran education', 'veteran business grants', 'reintegration programs',
//     'підприємництво ветеранів', 'освіта для ветеранів', 'бізнес-гранти для ветеранів', 'програми реінтеграції'
//   ],
//   'Навчання підприємництву': [
//     'entrepreneurship training', 'SME support', 'business incubation', 'business resilience programs',
//     'тренінги з підприємництва', 'підтримка МСП', 'бізнес-інкубація', 'програми бізнес-резильєнтності'
//   ],
//   'Вища освіта у менеджменті': [
//     'management education', 'business school funding', 'research grants in management', 'doctoral education funding', 'MBA', 'DBA',
//     'освіта в галузі менеджменту', 'фінансування бізнес-шкіл', 'гранти на дослідження у сфері менеджменту', 'фінансування докторських програм', 'MBA', 'DBA'
//   ],
//   'Корпоративне навчання': [
//     'corporate training', 'workforce upskilling', 'lifelong learning', 'l&d',
//     'корпоративне навчання', 'підвищення кваліфікації працівників', 'навчання впродовж життя', 'навчання та розвиток (L&D)'
//   ],
//   'Навчання жінок': [
//     'women entrepreneurship', 'women leadership programs', 'gender equity in business',
//     'жіноче підприємництво', 'програми жіночого лідерства', 'гендерна рівність у бізнесі'
//   ],
//   'Лідерство та резильєнтність': [
//     'leadership development', 'resilience training', 'adaptive leadership programs', 'business leadership', 'business resilience',
//     'розвиток лідерства', 'тренінги з резильєнтності', 'адаптивне лідерство', 'бізнес-лідерство', 'стійкість бізнесу'
//   ],
//   'Фінанси та інвестиції': [
//     'financial literacy programs', 'investment readiness', 'impact investment', 'economic empowerment',
//     'програми фінансової грамотності', 'готовність до інвестування', 'впливові інвестиції', 'економічне розширення можливостей'
//   ],
//   'Управління персоналом': [
//     'human capital development', 'HR management training', 'talent management grants',
//     'розвиток людського капіталу', 'навчання з управління персоналом', 'гранти на управління талантами'
//   ],
//   'Інвестиційні проєкти': [
//     'investment funding', 'business scaling grants', 'international cooperation in finance',
//     'фінансування інвестицій', 'гранти на масштабування бізнесу', 'міжнародне співробітництво у фінансах'
//   ]
// };

const VALID_TYPES = new Set(['grant', 'competition', 'tender']);
const VALID_REJECTION_REASONS = new Set([
  'no_matching_category',
  'irrelevant_topic',
  'internal_kse_opportunity'
]);

function normalizeExtractionResult(result) {
  if (!result || !result.title || typeof result.title !== 'string') {
    throw new Error('Invalid response: missing or invalid title');
  }

  if (result.category !== null && !categories.includes(result.category)) {
    throw new Error('Invalid response: unknown category');
  }

  const rejectionReason = VALID_REJECTION_REASONS.has(result.rejection_reason)
    ? result.rejection_reason
    : 'no_matching_category';

  return {
    title: result.title.trim(),
    deadline: typeof result.deadline === 'string' ? result.deadline : null,
    category: result.category === null ? null : result.category,
    type: VALID_TYPES.has(result.type) ? result.type : 'grant',
    low_budget: result.low_budget === true,
    rejection_reason: result.category === null ? rejectionReason : null
  };
}

async function extractGrantInfo(text, url, dependencies = {}) {
  const post = dependencies.post || axios.post;
  const reject = dependencies.saveRejectedGrant || saveRejectedGrant;
  const sleep = dependencies.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  // Validate inputs
  if (!text || text.trim().length < 50) {
    console.warn(`Insufficient text content for URL: ${url}`);
    return null;
  }

  // Truncate text if too long
  const truncatedText = text.length > CONFIG.MAX_TEXT_LENGTH
    ? text.substring(0, CONFIG.MAX_TEXT_LENGTH) + '...'
    : text;


  const prompt = `
Поверни рівно один JSON-об'єкт без Markdown:
{"title":"назва","deadline":"DD-MM-YYYY або null","category":"категорія або null","type":"grant|competition|tender","low_budget":true|false,"rejection_reason":"no_matching_category|irrelevant_topic|internal_kse_opportunity|null"}

Шукай лише можливості, де KSE як університет може отримати фінансування за надання навчальних або консультаційних послуг у категоріях: ${categories.join(', ')}.
- Не включай можливості лише для фізичних осіб і ті, де немає навчальної чи консультаційної складової.
- Якщо прямо вказаний бюджет на одного партнера менший за $30,000, постав low_budget: true. Якщо суми немає або вона від $30,000 — false. Не відхиляй можливість лише через малий бюджет.
- Відхили (category: null, rejection_reason: "irrelevant_topic") лише коли основною метою можливості є advocacy/адвокація, civil society/громадянське суспільство, democracy/democratization/демократія/демократизація, human rights/права людини або civic engagement/громадська участь. Побіжна згадка цих тем не є підставою для відхилення.
- Відхили (category: null, rejection_reason: "internal_kse_opportunity"), якщо KSE, Kyiv School of Economics або KSE Business School є донором чи організатором. Не відхиляй, якщо KSE лише може бути заявником або партнером.
- Якщо можливість не відповідає іншим критеріям, поверни category: null і rejection_reason: "no_matching_category".
- type: "grant" для грантового фінансування, "competition" для конкурсу з відбором переможців, "tender" для закупівлі/тендеру. Якщо тип неясний, використовуй "grant".

Текст гранту: "${truncatedText}"
`;

  // Ключові слова для категорій:
  // ${JSON.stringify(keywords, null, 2)}

  let attempt = 0;
  while (attempt < CONFIG.RETRY_COUNT) {
    try {
      const response = await post('https://api.openai.com/v1/chat/completions', {
        model: CONFIG.MODEL,
        messages: [{ role: 'user', content: prompt }],
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
          // 'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 seconds timeout
      });

      let content = response.data.choices[0].message.content;

      // Remove markdown code blocks if present
      content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();


      const result = normalizeExtractionResult(JSON.parse(content));

      if (result.category === null) {
        console.log(`Grant "${result.title}" from ${url} skipped - ${result.rejection_reason}`);
        // Save to rejected grants table to avoid reprocessing
        await reject(url, result.title, result.rejection_reason, text.substring(0, 1000));
        return null;
      }

      return { ...result, url };

    } catch (error) {
      attempt++;
      const isLastAttempt = attempt >= CONFIG.RETRY_COUNT;

      if (error.response?.status === 429) {
        // Rate limit error - wait longer
        const waitTime = CONFIG.RETRY_DELAY * attempt * 2;
        console.warn(`Rate limited for ${url}, retrying in ${waitTime}ms (attempt ${attempt}/${CONFIG.RETRY_COUNT})`);
        if (!isLastAttempt) {
          await sleep(waitTime);
          continue;
        }
      }

      if (isLastAttempt) {
        const errorMessage = error.response?.data?.error?.message || error.message;
        console.error(`Failed to extract grant info from ${url} after ${CONFIG.RETRY_COUNT} attempts:`, errorMessage);

        // Save to rejected grants table to avoid reprocessing
        await reject(url, null, `extraction_failed: ${errorMessage}`, text.substring(0, 1000));
        return null;
      }

      // Wait before retry
      await sleep(CONFIG.RETRY_DELAY * attempt);
    }
  }

  return null;
}

module.exports = { extractGrantInfo, normalizeExtractionResult, CONFIG };
