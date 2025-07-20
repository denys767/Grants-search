const axios = require('axios');
const path = require('path');
const { saveRejectedGrant } = require('../lib/db');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const CONFIG = {
    MAX_TEXT_LENGTH: 20000,
    RETRY_COUNT: 3,
    RETRY_DELAY: 1000,
   // TEMPERATURE: 0.2,
    MODEL: 'gpt-4o-mini',
    // MODEL: 'gpt-4.1-mini',
    DEBUG_LOGGING: process.env.DEBUG_AI_EXTRACTION === 'true' // Set to true in .env for deadline debugging
};

const categories = [
    'освіта', 'стартапи', 'підтримка ветеранів', 'підприємництво', 
    'бізнес-школи', 'корпоративне навчання', 'програми для жінок', 
    'лідерство й резильєнтність', 'фінанси й інвестиції', 'HR', 
    'інвестиційні проєкти'
];

// const keywords = {
//     'освіта': ['higher education funding', 'education grants', 'capacity building', 'professional development', 'business education', 'executive education', 'фінансування вищої освіти', 'освітні гранти', 'нарощування потенціалу', 'професійний розвиток', 'бізнес-освіта', 'управлінська освіта'],
//     'стартапи': ['startup grants', 'business acceleration', 'business incubation', 'incubator', 'innovations', 'incubator funding', 'гранти для стартапів', 'бізнес-акселерація', 'бізнес-інкубація', 'інкубатор', 'інновації', 'фінансування інкубаторів'],
//     'підтримка ветеранів': ['veteran entrepreneurship', 'veteran education', 'veteran business grants', 'reintegration programs', 'підприємництво ветеранів', 'освіта для ветеранів', 'бізнес-гранти для ветеранів', 'програми реінтеграції'],
//     'навчання підприємництву': ['entrepreneurship training', 'SME support', 'business incubation', 'business resilience programs', 'тренінги з підприємництва', 'підтримка МСП', 'бізнес-інкубація', 'програми бізнес-резильєнтності'],
//     'бізнес-школи': ['management education', 'business school funding', 'research grants in management', 'doctoral education funding', 'MBA', 'DBA', 'освіта в галузі менеджменту', 'фінансування бізнес-шкіл', 'гранти на дослідження у сфері менеджменту', 'фінансування докторських програм', 'MBA', 'DBA'],
//     'корпоративне навчання': ['corporate training', 'workforce upskilling', 'lifelong learning', 'l&d', 'корпоративне навчання', 'підвищення кваліфікації працівників', 'навчання впродовж життя', 'навчання та розвиток (L&D)'],
//     'програми для жінок': ['women entrepreneurship', 'women leadership programs', 'gender equity in business', 'жіноче підприємництво', 'програми жіночого лідерства', 'гендерна рівність у бізнесі'],
//     'лідерство й резильєєнтність': ['leadership development', 'resilience training', 'adaptive leadership programs', 'business leadership', 'business resilience', 'розвиток лідерства', 'тренінги з резильєнтності', 'адаптивне лідерство', 'бізнес-лідерство', 'стійкість бізнесу'],
//     'фінанси й інвестиції': ['financial literacy programs', 'investment readiness', 'impact investment', 'economic empowerment', 'програми фінансової грамотності', 'готовність до інвестування', 'впливові інвестиції', 'економічне розширення можливостей'],
//     'HR': ['human capital development', 'HR management training', 'talent management grants', 'розвиток людського капіталу', 'навчання з управління персоналом', 'гранти на управління талантами'],
//     'інвестиційні проєкти': ['investment funding', 'business scaling grants', 'international cooperation in finance', 'фінансування інвестицій', 'гранти на масштабування бізнесу', 'міжнародне співробітництво у фінансах']
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

    // Детальне логування тексту для дебагу дедлайнів
    if (CONFIG.DEBUG_LOGGING) {
        console.log(`\n🔍 DEBUG: Analyzing text for ${url}`);
        console.log(`📄 Original text length: ${text.length} characters`);
        console.log(`✂️ Truncated text length: ${truncatedText.length} characters`);
        
        // Показуємо перші та останні 300 символів для контексту
        console.log(`\n📖 TEXT PREVIEW (first 300 chars):`);
        console.log(`"${truncatedText.substring(0, 300)}..."`);
        
        if (truncatedText.length > 600) {
            console.log(`\n📖 TEXT PREVIEW (last 300 chars):`);
            console.log(`"...${truncatedText.substring(truncatedText.length - 300)}"`);
        }
        
        // Пошук можливих дедлайнів у тексті для дебагу
        const datePatterns = [
            /\d{1,2}[-./]\d{1,2}[-./]\d{4}/g,           // DD-MM-YYYY, DD.MM.YYYY, DD/MM/YYYY
            /\d{4}[-./]\d{1,2}[-./]\d{1,2}/g,           // YYYY-MM-DD, YYYY.MM.DD, YYYY/MM/DD  
            /\d{1,2}\s+(січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня)\s+\d{4}/gi,
            /\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}/gi,
            /(до|до\s+|deadline|термін|крайній\s+термін|дедлайн).{0,50}\d{1,2}[-./]\d{1,2}[-./]\d{4}/gi
        ];
        
        console.log(`\n🗓️ SEARCHING FOR DATES IN TEXT:`);
        datePatterns.forEach((pattern, index) => {
            const matches = truncatedText.match(pattern);
            if (matches) {
                console.log(`   Pattern ${index + 1}: ${matches.slice(0, 3).join(', ')}${matches.length > 3 ? ` (and ${matches.length - 3} more)` : ''}`);
            }
        });
    }

    const prompt = `
        Твоя задача, витягнути з тексту інформацію про грант. \n

        Мені потрібні такі поля, які ти заповниш інформацією з тексту: \n
        1. Назва можливості (title) \n
        2. Дедлайн у форматі DD-MM-YYYY (deadline). Якщо грант безстроковий, поверни null. \n
        3. Категорія (category). На основі контексту вибери одну з цих категорій: ${categories.join(', ')}. Якщо категорія не підходить, поверни null, не вигадуй нові категорії, використай тільки те, що я вказав. \n

        Поверни відповідь у форматі JSON (І ТІЛЬКИ У ФОРМАТІ JSON, НІЧОГО БІЛЬШЕ). Наприклад: {"title": "Назва гранту", "deadline": "31-12-2024", "category": "Освіта"} \n


        Текст для опрацювання:\n "${truncatedText}"
    `;
// Ключові слова для категорій:
// ${JSON.stringify(keywords, null, 2)}

    // Логування промпту для дебагу
    if (CONFIG.DEBUG_LOGGING) {
        console.log(`\n💬 PROMPT SENT TO AI:`);
        console.log(`"${prompt.substring(0, 500)}..."`);
        console.log(`📏 Prompt length: ${prompt.length} characters`);
        console.log(`🤖 Using model: ${CONFIG.MODEL}`);
        console.log(`🌡️ Temperature: ${CONFIG.TEMPERATURE || 'default'}`);
    }

    let attempt = 0;
    while (attempt < CONFIG.RETRY_COUNT) {
        try {
            const response = await axios.post('https://api.openai.com/v1/chat/completions', {
                model: CONFIG.MODEL,
                messages: [{ role: 'user', content: prompt }],
                temperature: CONFIG.TEMPERATURE,
            }, {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000 // 30 seconds timeout
            });

            let content = response.data.choices[0].message.content;
            
            // Логування сирої відповіді від AI
            if (CONFIG.DEBUG_LOGGING) {
                console.log(`\n🤖 AI RAW RESPONSE:`);
                console.log(`"${content}"`);
            }
            
            // Remove markdown code blocks if present
            content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            
            if (CONFIG.DEBUG_LOGGING) {
                console.log(`\n🧹 AI CLEANED RESPONSE:`);
                console.log(`"${content}"`);
            }
            
            const result = JSON.parse(content);

            // Детальне логування парсінгу результату
            if (CONFIG.DEBUG_LOGGING) {
                console.log(`\n📊 PARSED RESULT:`);
                console.log(`   Title: "${result.title}"`);
                console.log(`   Deadline: "${result.deadline}"`);
                console.log(`   Category: "${result.category}"`);
                
                // Additional deadline debugging
                if (result.deadline) {
                    console.log(`\n🗓️ DEADLINE ANALYSIS:`);
                    console.log(`   Raw deadline from AI: "${result.deadline}"`);
                    console.log(`   Type: ${typeof result.deadline}`);
                    console.log(`   Length: ${result.deadline.length}`);
                    
                    // Test the date conversion that will happen in the database
                    const parts = result.deadline.split('-');
                    if (parts.length === 3) {
                        const day = parseInt(parts[0], 10);
                        const month = parseInt(parts[1], 10);
                        const year = parseInt(parts[2], 10);
                        console.log(`   Parsed: Day=${day}, Month=${month}, Year=${year}`);
                        
                        // Show what the database conversion will produce
                        const paddedMonth = month.toString().padStart(2, '0');
                        const paddedDay = day.toString().padStart(2, '0');
                        const dbFormat = `${year}-${paddedMonth}-${paddedDay}`;
                        console.log(`   Will be stored in DB as: "${dbFormat}"`);
                    }
                }
            }

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

            if (CONFIG.DEBUG_LOGGING) {
                console.log(`✅ Successfully extracted grant info for: "${result.title}"`);
                console.log(`   📅 Found deadline: ${result.deadline || 'null'}`);
                console.log(`   🏷️ Assigned category: ${result.category}\n`);
            } else {
                console.log(`✅ Extracted: "${result.title}" (deadline: ${result.deadline || 'null'})`);
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
