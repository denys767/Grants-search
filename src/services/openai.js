const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const categories = [
    'освіта', 'стартапи', 'підтримка ветеранів', 'підприємництво', 
    'бізнес-школи', 'корпоративне навчання', 'програми для жінок', 
    'лідерство й резильєнтність', 'фінанси й інвестиції', 'HR', 
    'інвестиційні проєкти'
];

const keywords = {
    'освіта': ['higher education funding', 'education grants', 'capacity building', 'professional development', 'business education', 'executive education', 'фінансування вищої освіти', 'освітні гранти', 'нарощування потенціалу', 'професійний розвиток', 'бізнес-освіта', 'управлінська освіта'],
    'стартапи': ['startup grants', 'business acceleration', 'business incubation', 'incubator', 'innovations', 'incubator funding', 'гранти для стартапів', 'бізнес-акселерація', 'бізнес-інкубація', 'інкубатор', 'інновації', 'фінансування інкубаторів'],
    'підтримка ветеранів': ['veteran entrepreneurship', 'veteran education', 'veteran business grants', 'reintegration programs', 'підприємництво ветеранів', 'освіта для ветеранів', 'бізнес-гранти для ветеранів', 'програми реінтеграції'],
    'навчання підприємництву': ['entrepreneurship training', 'SME support', 'business incubation', 'business resilience programs', 'тренінги з підприємництва', 'підтримка МСП', 'бізнес-інкубація', 'програми бізнес-резильєнтності'],
    'бізнес-школи': ['management education', 'business school funding', 'research grants in management', 'doctoral education funding', 'MBA', 'DBA', 'освіта в галузі менеджменту', 'фінансування бізнес-шкіл', 'гранти на дослідження у сфері менеджменту', 'фінансування докторських програм', 'MBA', 'DBA'],
    'корпоративне навчання': ['corporate training', 'workforce upskilling', 'lifelong learning', 'l&d', 'корпоративне навчання', 'підвищення кваліфікації працівників', 'навчання впродовж життя', 'навчання та розвиток (L&D)'],
    'програми для жінок': ['women entrepreneurship', 'women leadership programs', 'gender equity in business', 'жіноче підприємництво', 'програми жіночого лідерства', 'гендерна рівність у бізнесі'],
    'лідерство й резильєєнтність': ['leadership development', 'resilience training', 'adaptive leadership programs', 'business leadership', 'business resilience', 'розвиток лідерства', 'тренінги з резильєнтності', 'адаптивне лідерство', 'бізнес-лідерство', 'стійкість бізнесу'],
    'фінанси й інвестиції': ['financial literacy programs', 'investment readiness', 'impact investment', 'economic empowerment', 'програми фінансової грамотності', 'готовність до інвестування', 'впливові інвестиції', 'економічне розширення можливостей'],
    'HR': ['human capital development', 'HR management training', 'talent management grants', 'розвиток людського капіталу', 'навчання з управління персоналом', 'гранти на управління талантами'],
    'інвестиційні проєкти': ['investment funding', 'business scaling grants', 'international cooperation in finance', 'фінансування інвестицій', 'гранти на масштабування бізнесу', 'міжнародне співробітництво у фінансах']
};

async function extractGrantInfo(text, url) {
    const prompt = `
        Витягни з наступного тексту інформацію про грант. 
        Текст: "${text.substring(0, 4000)}"

        Мені потрібні такі поля:
        1. Назва можливості (title)
        2. Дедлайн у форматі DD-MM-YYYY (deadline). Якщо не знайдено, вкажи null
        3. Категорія (category). На основі ключових слів чи контексту вибери одну з цих категорій : ${categories.join(', ')}. Якщо жодна категорія не підходить, вкажи null

        Ключові слова для категорій:
        ${JSON.stringify(keywords, null, 2)}

        Поверни відповідь у форматі JSON (І ТІЛЬКИ У ФОРМАТІ JSON, НІЧОГО БІЛЬШЕ). Наприклад: {"title": "Назва гранту", "deadline": "31-12-2024", "category": "Освіта"}
    `;

    try {
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.2,
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            }
        });

        let content = response.data.choices[0].message.content;
        
        // Remove markdown code blocks if present
        content = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        
        const result = JSON.parse(content);

        if (result.category === null) {
            console.log(`Grant "${result.title}" from ${url} skipped because it does not match any category.`);
            return null;
        }

        return { ...result, url };

    } catch (error) {
        console.error('Error calling OpenAI API:', error.response ? error.response.data : error.message);
        return null;
    }
}

module.exports = { extractGrantInfo };
