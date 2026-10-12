const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const { saveRejectedGrant } = require('../lib/db');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const CONFIG = {
  MAX_TEXT_LENGTH: 50000,
  RETRY_COUNT: 3,
  RETRY_DELAY: 1000,
  MODEL: 'claude-haiku-5-5',
  MAX_TOKENS: 16000,
  EFFORT: 'low',
  REQUEST_TIMEOUT: 60000
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

// Set once the API reports a condition that no retry can fix (exhausted
// credits, invalid key). Cleared at the start of every scheduled run.
let fatalApiError = null;

let client = null;

// Created lazily so that tests (and code paths that never call the API) do
// not need ANTHROPIC_API_KEY. The retry loop below owns all retries, so the
// SDK's own retries are disabled to avoid retrying twice.
function getClient() {
  if (!client) {
    client = new Anthropic({ maxRetries: 0, timeout: CONFIG.REQUEST_TIMEOUT });
  }
  return client;
}

function defaultCreateMessage(params) {
  return getClient().messages.create(params);
}

// 401/403 (bad key, no permission) and an empty credit balance (reported as a
// 400 invalid_request_error) cannot be fixed by retrying.
function isFatalApiError(error) {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return true;
  }
  const status = error.status;
  if (status === 401 || status === 403) return true;
  return /credit balance is too low/i.test(error.message || '');
}

function isRetryableApiError(error) {
  if (error instanceof Anthropic.APIConnectionError) return true;
  const status = error.status;
  return status === 429 || status === 529 || (typeof status === 'number' && status >= 500);
}

function isLlmUnavailable() {
  return fatalApiError !== null;
}

function resetLlmAvailability() {
  fatalApiError = null;
}

const VALID_TYPES = new Set(['grant', 'competition', 'tender']);
const REJECTION_REASONS = [
  'no_matching_category',
  'irrelevant_topic',
  'internal_kse_opportunity',
  'kse_not_service_provider',
  'expired'
];
const VALID_REJECTION_REASONS = new Set(REJECTION_REASONS);

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    deadline: { type: ['string', 'null'] },
    category: { anyOf: [{ type: 'string', enum: categories }, { type: 'null' }] },
    type: { type: 'string', enum: [...VALID_TYPES] },
    low_budget: { type: 'boolean' },
    rejection_reason: { anyOf: [{ type: 'string', enum: REJECTION_REASONS }, { type: 'null' }] }
  },
  required: ['title', 'deadline', 'category', 'type', 'low_budget', 'rejection_reason'],
  additionalProperties: false
};

const SYSTEM_PROMPT = `Ти фільтруєш можливості (гранти, конкурси, тендери) для KSE (Kyiv School of Economics) — університету та бізнес-школи. Для кожної можливості поверни JSON за заданою схемою.

Головний критерій: KSE має змогу бути заявником або грантоотримувачем — організацією, яка отримує кошти та надає навчальні, тренінгові чи консультаційні послуги (або реалізує програму) в межах цієї можливості. Якщо KSE може бути лише учасником, слухачем чи бенефіціаром — можливість не підходить.

Шукай лише можливості в категоріях: ${categories.join(', ')}.

Правила (category: null і відповідний rejection_reason, якщо можливість не підходить):
- "expired": дедлайн (див. правило для deadline) уже минув відносно поточної дати з повідомлення користувача. Також, якщо дедлайну немає, але з тексту видно, що це минула програма (наприклад, реєстрація чи старт були роки тому, як-от у 2016 році, або всі заходи вже відбулися), а не чинний відкритий набір.
- "kse_not_service_provider": кошти йдуть фізичним особам (стипендії, індивідуальні гранти чи ваучери на перепідготовку для ВПО, ветеранів, студентів тощо, де отримувач сам обирає курси); KSE могла б бути лише учасником чи слухачем; кошти призначені на обладнання чи бізнес-капітал для МСП або фізичних осіб без навчального/консультаційного контракту, відкритого для установи; а також подібні випадки, де KSE не може бути організацією, що отримує фінансування за надання освітніх чи консультаційних послуг. Приклад: «Індивідуальний грант на перепідготовку ВПО» від Карітас (виплати людям, щоб вони пройшли короткі курси) → kse_not_service_provider.
- "irrelevant_topic": лише коли основною метою є advocacy/адвокація, civil society/громадянське суспільство, democracy/democratization/демократія/демократизація, human rights/права людини або civic engagement/громадська участь. Побіжна згадка цих тем не є підставою для відхилення.
- "internal_kse_opportunity": KSE, Kyiv School of Economics або KSE Business School є донором чи організатором. Не відхиляй, якщо KSE лише може бути заявником або партнером.
- "no_matching_category": можливість не відповідає іншим критеріям.
- Якщо можливість підходить, category — одна з категорій, rejection_reason: null.
- low_budget: true, якщо прямо вказаний бюджет на одного партнера менший за $30,000; якщо суми немає або вона від $30,000 — false. Не відхиляй можливість лише через малий бюджет.
- type: "grant" для грантового фінансування, "competition" для конкурсу з відбором переможців, "tender" для закупівлі/тендеру. Якщо тип неясний, "grant".
- deadline у форматі DD-MM-YYYY — остання дата, до якої можна подати заявку: «дедлайн», «прийом заявок до», «реєстрація триває до», «подати до» тощо. Якщо є кілька наборів чи етапів подачі, бери найпізнішу з цих дат. Дати проведення заходів, навчання чи оголошення результатів не є дедлайном. Якщо в даті немає року, визнач його з контексту тексту. null — лише коли в тексті немає жодної дати завершення подачі. Приклад: «Реєстрація триватиме до 5 серпня 2026 року; тренінги 19–21 серпня» → deadline: "05-08-2026".`;

function formatDate(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
}

function parseDeadline(deadline) {
  const match = typeof deadline === 'string' && deadline.trim().match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match.map(Number);
  const date = new Date(year, month - 1, day);
  const valid = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  return valid ? date : null;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function normalizeExtractionResult(result, today = new Date()) {
  if (!result || !result.title || typeof result.title !== 'string') {
    throw new Error('Invalid response: missing or invalid title');
  }

  if (result.category !== null && !categories.includes(result.category)) {
    throw new Error('Invalid response: unknown category');
  }

  const deadline = typeof result.deadline === 'string' ? result.deadline : null;
  const deadlineDate = parseDeadline(deadline);
  const expired = deadlineDate !== null && deadlineDate < startOfDay(today);

  const category = expired ? null : result.category;
  const rejectionReason = expired
    ? 'expired'
    : VALID_REJECTION_REASONS.has(result.rejection_reason)
      ? result.rejection_reason
      : 'no_matching_category';

  return {
    title: result.title.trim(),
    deadline,
    category,
    type: VALID_TYPES.has(result.type) ? result.type : 'grant',
    low_budget: result.low_budget === true,
    rejection_reason: category === null ? rejectionReason : null
  };
}

async function extractGrantInfo(text, url, dependencies = {}) {
  const createMessage = dependencies.createMessage || defaultCreateMessage;
  const reject = dependencies.saveRejectedGrant || saveRejectedGrant;
  const sleep = dependencies.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const today = dependencies.today ? new Date(dependencies.today) : new Date();
  if (fatalApiError) {
    console.warn(`Skipping extraction for ${url}: LLM unavailable (${fatalApiError})`);
    return null;
  }

  // Validate inputs
  if (!text || text.trim().length < 50) {
    console.warn(`Insufficient text content for URL: ${url}`);
    return null;
  }

  // Truncate text if too long
  const truncatedText = text.length > CONFIG.MAX_TEXT_LENGTH
    ? text.substring(0, CONFIG.MAX_TEXT_LENGTH) + '...'
    : text;

  // The date changes every day, so it goes in the user message to keep the
  // system prompt byte-stable.
  const userMessage = `Поточна дата: ${formatDate(today)} (DD-MM-YYYY).\n\nТекст можливості:\n"${truncatedText}"`;

  let attempt = 0;
  while (attempt < CONFIG.RETRY_COUNT) {
    try {
      const response = await createMessage({
        model: CONFIG.MODEL,
        max_tokens: CONFIG.MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        output_config: {
          effort: CONFIG.EFFORT,
          format: { type: 'json_schema', schema: OUTPUT_SCHEMA }
        }
      });

      if (response.stop_reason === 'refusal') {
        // A refusal says nothing about the opportunity: not a rejection.
        console.warn(`Model refused to process ${url} (${response.stop_details?.category || 'no category'})`);
        return null;
      }

      const textBlock = (response.content || []).find(block => block.type === 'text');
      if (!textBlock) {
        throw new Error('Invalid response: no text block');
      }

      // Remove markdown code blocks if present
      const content = textBlock.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

      const result = normalizeExtractionResult(JSON.parse(content), today);

      if (result.category === null) {
        console.log(`Grant "${result.title}" from ${url} skipped - ${result.rejection_reason}`);
        // Save to rejected grants table to avoid reprocessing
        await reject(url, result.title, result.rejection_reason, text.substring(0, 1000));
        return null;
      }

      return { ...result, url };

    } catch (error) {
      if (isFatalApiError(error)) {
        fatalApiError = error.message;
        console.error(`LLM unavailable for the rest of this run: ${fatalApiError}`);
        return null;
      }

      attempt++;
      // Other 4xx API errors (e.g. a malformed request) will not succeed on retry;
      // malformed model output (JSON/validation errors) still gets another attempt.
      const isLastAttempt = attempt >= CONFIG.RETRY_COUNT ||
        (error instanceof Anthropic.APIError && !isRetryableApiError(error));

      if (isLastAttempt) {
        console.error(`Failed to extract grant info from ${url} after ${attempt} attempt(s):`, error.message);

        // A failed request does not say anything about the opportunity itself.
        // Do not blacklist its URL: transient errors (including exhausted API
        // credits) must be eligible for a later scheduled run.
        return null;
      }

      // Rate limit / overload: wait longer
      const overloaded = error.status === 429 || error.status === 529;
      const waitTime = CONFIG.RETRY_DELAY * attempt * (overloaded ? 2 : 1);
      if (overloaded) {
        console.warn(`Rate limited or overloaded for ${url}, retrying in ${waitTime}ms (attempt ${attempt}/${CONFIG.RETRY_COUNT})`);
      }
      await sleep(waitTime);
    }
  }

  return null;
}

module.exports = {
  extractGrantInfo,
  normalizeExtractionResult,
  isLlmUnavailable,
  resetLlmAvailability,
  OUTPUT_SCHEMA,
  SYSTEM_PROMPT,
  CONFIG
};
