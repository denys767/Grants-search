const axios = require('axios');
const path = require('path');
const { saveRejectedGrant } = require('../lib/db');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const CONFIG = {
  MAX_TEXT_LENGTH: 10000,
  RETRY_COUNT: 3,
  RETRY_DELAY: 1000,
  TEMPERATURE: 1,
  MODEL: 'gpt-5-nano'
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

async function extractGrantInfo(text, url) {
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
Витягни з тексту:
- title: назва
- deadline: DD-MM-YYYY або null
- category: одна з ${categories.join(', ')}
Потрібні лише ті гранти, в яких організація (університет KSE) може отримати фінансування за надання навчальних чи консультаційних послуг у вищезазначених категоріях. Встанови null крім title, якщо грант не підходить за цим критерієм або сума гранту <20k$ (Якщо сума не вказана, ігноруй мінімальну суму). 

Не включати можливості лише для участі як фізособа та ті де немає освітньої складової (наприклад, ремонти, інфраструктура, культурні заходи без навчання). Має бути навчальна або консультаційна складова. 
Включати гранти для навчання з підприємництва, стартапів, підтримки ветеранів тощо — якщо подання від імені університету KSE можливе.

Що точно включати до вибірки грантів:
Навчання підприємництву:
для жінок, ветеранів, молоді, МСП, ВПО, репатріантів;
Програми з менторства / коучингу / бізнес-консалтингу;
Освітні програми (короткострокові, сертифікатні, MBA, PhD);
Навчання в темах:
бізнес-планування, фінанси, маркетинг, e-commerce, інвестиції, GR, управління ризиками, SMM, лідерство, резильєнтність;
Створення/підтримка акселераторів, інкубаторів, буткемпів;
Проведення воркшопів, тренінгів, інтенсивів у сферах бізнесу та управління;
Програми економічної інклюзії через освіту;
Нетворкінг події, демо-дні, пітч-захисти, фінальні презентації як частину навчальних програм;
LMS-платформи для підтримки навчання (як частина гранту);
Регіональні / виїзні навчальні модулі (якщо KSE GBS може бути реалізатором або партнером).

JSON: {"title": "назва", "deadline": "31-12-2024", "category": "категорія"}
Текст гранту: "${truncatedText}"
`;

  // Ключові слова для категорій:
  // ${JSON.stringify(keywords, null, 2)}

  let attempt = 0;
  while (attempt < CONFIG.RETRY_COUNT) {
    try {
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

      let content = response.data.choices[0].message.content;

      // Remove markdown code blocks if present
      content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();


      const result = JSON.parse(content);

      // Validate result structure
      if (!result.title || typeof result.title !== 'string') {
        throw new Error('Invalid response: missing or invalid title');
      }

      if (result.category === null) {
        console.log(`Grant "${result.title}" from ${url} skipped - no matching category`);
        // Save to rejected grants table to avoid reprocessing
        await saveRejectedGrant(url, result.title, 'no_matching_category', text.substring(0, 1000));
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
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
      }

      if (isLastAttempt) {
        const errorMessage = error.response?.data?.error?.message || error.message;
        console.error(`Failed to extract grant info from ${url} after ${CONFIG.RETRY_COUNT} attempts:`, errorMessage);

        // Save to rejected grants table to avoid reprocessing
        await saveRejectedGrant(url, null, `extraction_failed: ${errorMessage}`, text.substring(0, 1000));
        return null;
      }

      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY * attempt));
    }
  }

  return null;
}

module.exports = { extractGrantInfo };
