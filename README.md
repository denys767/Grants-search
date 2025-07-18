# Пошук Грантів

Цей проєкт автоматично збирає інформацію про гранти з різних джерел, аналізує її за допомогою OpenAI та надсилає сповіщення в Slack. Наразі активно працює пошук грантів на prostir.ua, з підтримкою інших джерел.

## Функціонал

- 🔍 **Автоматичний скрапінг грантів** з prostir.ua (активний) та інших джерел
- 🤖 **Аналіз та категоризація грантів** за допомогою OpenAI
- 📊 **Slack-бот з інтерактивним інтерфейсом**
- 🔄 **Фільтрація грантів** за категоріями
- 📅 **Сортування за дедлайнами** (зростання/спадання)
- 📑 **Пагінація результатів** (5 грантів на сторінку)
- 📬 **Щотижневі автоматичні звіти**
- 🗄️ **Зберігання в MySQL базі даних**
- ⚡ **Інтерактивні кнопки та команди** в Slack
- 🚫 **Система відхилених грантів** - запобігає повторній обробці неактуальних URL
- 🔄 **Batch processing** - паралельна обробка для підвищення швидкості
- 📊 **Інтелектуальна фільтрація URL** - перевірка існуючих та відхилених грантів

## Встановлення

1. **Клонуйте репозиторій:**
   ```bash
   git clone <URL репозиторію>
   cd grants-search
   ```

2. **Встановіть залежності:**
   ```bash
   npm install
   ```

3. **Встановіть Playwright браузери:**
   ```bash
   npx playwright install
   ```

## Конфігурація

1. **Створіть файл `.env`**, скопіювавши `example.env`:
   ```bash
   copy example.env .env
   ```

2. **Заповніть `.env` файл вашими даними:**

   **Основні налаштування:**
   - `DB_HOST`: хост бази даних (зазвичай `localhost`)
   - `DB_USER`: ім'я користувача MySQL
   - `DB_PASSWORD`: пароль користувача MySQL
   - `DB_NAME`: назва бази даних (наприклад, `grant_opportunities`)
   - `SLACK_BOT_TOKEN`: токен Slack-бота (починається з `xoxb-`)
   - `SLACK_SIGNING_SECRET`: секрет підпису Slack-додатку
   - `SLACK_CHANNEL_ID`: ID каналу для автоматичних звітів
   - `OPENAI_API_KEY`: ключ OpenAI API (починається з `sk-`)
   - `PORT`: порт для Slack-бота (за замовчуванням 3000)

   **Додаткові налаштування:**
   - `NODE_ENV`: режим роботи (`production`, `development`, `test`)
   - `RUN_SCRAPING_ON_STARTUP`: запуск скрапінгу при старті (`true`/`false`)
   - `RUN_WEEKLY_REPORT_ON_STARTUP`: відправка звіту при старті (`true`/`false`)
   - `ENABLE_SCHEDULED_SCRAPING`: увімкнути планований скрапінг (`true`/`false`)
   - `ENABLE_SCHEDULED_REPORTS`: увімкнути планові звіти (`true`/`false`)
   - `DEBUG_AI_EXTRACTION`: детальні логи AI обробки (`true`/`false`)
   - `GRANT_MARKET_MAX_LOAD_MORE`: максимум кліків "Показати ще" для grant.market (за замовчуванням: 20)
   - `GRANT_MARKET_MAX_GRANTS`: максимум грантів для обробки за раз (за замовчуванням: 50, встановіть 999 для всіх)
   - `GRANT_MARKET_BATCH_SIZE`: кількість грантів для паралельної обробки (за замовчуванням: 5)
   - `GRANT_MARKET_BATCH_DELAY`: затримка між батчами в мс (за замовчуванням: 1000)

## Налаштування Slack-бота

1. **Створіть Slack-додаток:**
   - Перейдіть на [Slack API](https://api.slack.com/apps)
   - Натисніть "Create New App" → "From scratch"
   - Введіть назву додатку та виберіть робочий простір

2. **Налаштуйте права доступу (Bot Token Scopes):**
   - Перейдіть до "OAuth & Permissions"
   - Додайте наступні права: `app_mentions:read`, `channels:read`, `chat:write`, `commands`, `groups:read`, `im:read`, `mpim:read`
   - Встановіть додаток у робочий простір

3. **Налаштуйте слеш-команди:**
   - Перейдіть до "Slash Commands"
   - Створіть команду `/grants` з описом "Пошук та фільтрація грантів"
   - Request URL: `https://your-domain.ngrok-free.app/slack/events`

4. **Увімкніть інтерактивність:**
   - Перейдіть до "Interactivity & Shortcuts"
   - Увімкніть "Interactivity"
   - Request URL: `https://your-domain.ngrok-free.app/slack/events`

5. **Налаштуйте події (Event Subscriptions):**
   - Перейдіть до "Event Subscriptions"
   - Увімкніть події
   - Request URL: `https://your-domain.ngrok-free.app/slack/events`
   - Підпишіться на події: `app_mention`

6. **Отримайте токени:**
   - Bot User OAuth Token (з "OAuth & Permissions") → `SLACK_BOT_TOKEN`
   - Signing Secret (з "Basic Information") → `SLACK_SIGNING_SECRET`

## Запуск проєкту

### 1. Налаштування бази даних

Перед першим запуском створіть базу даних та таблицю:

```bash
npm run setup-db
```

### 2. Запуск для розробки (з ngrok)

1. **Встановіть ngrok** (якщо ще не встановлений):
   ```bash
   # Завантажте з https://ngrok.com/download
   # Або встановіть через пакетний менеджер
   ```

2. **Запустіть ngrok в окремому терміналі:**
   ```bash
   ngrok http 3000
   ```

3. **Скопіюйте HTTPS URL** (наприклад, `https://abc123.ngrok-free.app`) та оновіть налаштування Slack-додатку

4. **Запустіть додаток:**
   ```bash
   npm start
   ```

### 3. Запуск для продакшену

```bash
npm start
```

### 4. Додаткові скрипти для тестування

```bash
# Тест лише скрапінгу (без Slack)
npm run test-scrape

# Тест і скрапінгу і звіту одночасно
npm run test-both

# Розробка з автоматичним звітом при запуску
npm run dev
```

### 5. Режими роботи

Проєкт підтримує різні режими через змінні середовища:

**Production режим** (за замовчуванням):
```bash
NODE_ENV=production npm start
```
- Планований скрапінг та звіти увімкнені
- Запуск лише за розкладом

**Development режим**:
```bash
npm run dev
```
- Увімкнені всі функції
- Автоматичний звіт при запуску для тестування

**Test режим**:
```bash
NODE_ENV=test npm start
```
- Планові завдання вимкнені
- Лише Slack-бот для ручного тестування

*Примітка: для продакшену використовуйте власний домен замість ngrok*


## Використання Slack-бота

### Команди

- **`/grants`** - відкриває інтерактивне меню для перегляду грантів
- **`@bot_name` + текст** - пошук грантів за ключовими словами

### Інтерактивні функції

1. **Фільтрація за категоріями:**
   - Освіта та наука
   - Культура та мистецтво
   - Соціальні проєкти
   - Екологія та довкілля
   - Технології та інновації
   - Охорона здоров'я
   - Права людини
   - Молодіжні ініціативи

2. **Сортування:**
   - За дедлайном (найближчі спочатку)
   - За дедлайном (найдальші спочатку)

3. **Пагінація:**
   - 5 грантів на сторінку
   - Кнопки "Попередня" / "Наступна" сторінка

### Автоматичні звіти

Бот автоматично надсилає щотижневі звіти про **нові гранти** (знайдені за останні 7 днів) щонеділі о 09:00 в налаштований канал.

**Важливо:** Звіт містить лише ті гранти, які були додані до бази даних протягом останнього тижня, а не всі гранти з бази.

### Розклад автоматизації

- **Щонеділі о 08:00** - автоматичний скрапінг нових грантів
- **Щонеділі о 09:00** - розсилка щотижневого звіту з новими грантами

### Тестування

Для тестування щотижневого звіту використовуйте:
```bash
npm run test-weekly
```

Для тестування лише скрапінгу:
```bash
npm run test-scrape
```

## Покращення продуктивності

### Результати оптимізацій

| Метрика | До оптимізації | Після оптимізації | Покращення |
|---------|---------------|------------------|------------|
| **Час обробки** | 2-3 хвилини | 10-30 секунд | **~85% швидше** |
| **OpenAI API виклики** | Повторні виклики | Лише нові URL | **~70% економія** |
| **Використання браузера** | Новий браузер на URL | Повторне використання | **~80% менше пам'яті** |
| **Повторна обробка** | Завжди | Тільки нові URL | **~90% менше роботи** |

### Налаштування продуктивності

У кожному скрапері можна налаштувати:
```javascript
this.maxPages = 10;           // Максимум сторінок для сканування
this.batchSize = 3;           // URL в одному batch (3-5 оптимально)
this.delayBetweenBatches = 500; // Затримка між batch (500-1000ms)
```

## Архітектура та оптимізації

### Система відхилених грантів

Проєкт включає розумну систему для запобігання повторної обробки неактуальних URL:

- **`rejected_grants` таблиця** - зберігає URL, які не змогли бути оброблені
- **Причини відхилення:**
  - `no_matching_category` - грант не підходить під жодну категорію
  - `extraction_failed` - помилка при обробці через OpenAI
  - `no_meaningful_content` - сторінка не містить корисного контенту

### Оптимізації продуктивності

- **Batch processing** - паралельна обробка URL у групах (3-5 за раз для prostir.ua, 5 за раз для grant.market)
- **Динамічна пагінація** - автоматичне завантаження всіх сторінок для grant.market через кнопку "Показати ще"
- **Інтелектуальна фільтрація** - перевірка існуючих та відхилених URL перед обробкою
- **Повторне використання браузера** - один екземпляр браузера на скрапер
- **Rate limiting** - затримки між запитами для дбайливого ставлення до серверів
- **Retry logic** - автоматичні повторні спроби з експоненційною затримкою
- **Конфігуровані обмеження** - налаштування максимальної кількості грантів через змінні середовища

### Моніторинг відхилених грантів

Для перегляду відхилених грантів можна використати:
```javascript
const { getRejectedGrants } = require('./src/lib/db');
const rejected = await getRejectedGrants({ limit: 20 });
```

## Структура проєкту

```
├── src/
│   ├── config/
│   │   └── index.js           # Конфігураційні налаштування
│   ├── lib/
│   │   └── db.js              # Робота з базою даних MySQL
│   ├── scrapers/
│   │   ├── baseScraper.js     # Базовий клас для скраперів
│   │   ├── prostirScraper.js  # Скрапер для prostir.ua (активний)
│   │   ├── euScraper.js       # Скрапер для EU Portal
│   │   ├── grantMarketScraper.js # Скрапер для Grant Market
│   │   ├── gurtScraper.js     # Скрапер для GURT
│   │   └── opportunityDeskScraper.js # Скрапер для Opportunity Desk
│   ├── services/
│   │   ├── openai.js          # Інтеграція з OpenAI для категоризації
│   │   └── slack.js           # Slack-бот та інтерактивний інтерфейс
│   └── main.js                # Головний файл додатку
├── html samples/              # Зразки HTML для розробки скраперів
├── package.json
├── example.env                # Приклад конфігурації
└── README.md
```

## Залежності

- **@slack/bolt** - Slack Bolt framework для бота
- **axios** - HTTP-клієнт для запитів
- **cheerio** - jQuery-подібний парсер HTML
- **dotenv** - Завантаження змінних середовища
- **mysql2** - MySQL драйвер для Node.js
- **node-cron** - Планувальник завдань
- **playwright** - Бібліотека для автоматизації браузера

## Розробка

### Додавання нових скраперів

1. Створіть новий файл у папці `src/scrapers/`
2. Розширте клас `BaseScraper`
3. Реалізуйте метод `scrape()`
4. Додайте скрапер до масиву `sources` у `main.js`
5. Розкоментуйте відповідний рядок у `main.js`

**Доступні скрапери:**
- `prostirScraper` - активний (prostir.ua з динамічною пагінацією)
- `grantMarketScraper` - з підтримкою кнопки "Показати ще"
- `euScraper` - доступний, але закоментований
- `gurtScraper` - доступний, але закоментований
- `opportunityDeskScraper` - доступний, але закоментований

**Особливості скраперів:**
- **Grant Market**: Автоматично натискає кнопку "Показати ще" для завантаження всіх грантів + паралельна обробка
- **Prostir**: Обробляє пагінацію через URL параметри + паралельна обробка
- **EU Portal**: Статичне завантаження списку

**Продуктивність паралельної обробки:**
| Кількість грантів | Послідовна обробка | Паралельна обробка | Покращення |
|------------------|-------------------|-------------------|------------|
| 20 грантів | ~60 секунд | ~15 секунд | **75% швидше** |
| 50 грантів | ~2.5 хвилини | ~40 секунд | **73% швидше** |
| 100 грантів | ~5 хвилин | ~1.3 хвилини | **74% швидше** |

### Активація додаткових скраперів

Для активації інших джерел розкоментуйте відповідні рядки в `src/main.js`:
```javascript
const sources = [
    gurtScraper,        // Розкоментуйте для активації
    prostirScraper,     // Активний
    grantMarketScraper, // Розкоментуйте для активації
    euScraper,          // Розкоментуйте для активації
    opportunityDeskScraper // Розкоментуйте для активації
];
```

### Додавання нових категорій

Оновіть список категорій в `src/services/openai.js` та `src/services/slack.js`.

## Часто задавані питання (FAQ)

### Чому гранти не зберігаються в базу даних?

1. Перевірте, чи правильно налаштований OpenAI API ключ
2. Переконайтеся, що гранти отримують валідну категорію (не "Не визначено")
3. Перевірте логи в консолі на наявність помилок SQL
4. Можливо, гранти були відхилені та збережені в `rejected_grants` таблицю

### Як перевірити відхилені гранти?

Відхилені гранти зберігаються в окремій таблиці, щоб уникнути повторної обробки:
```sql
SELECT * FROM rejected_grants ORDER BY created_at DESC LIMIT 10;
```

Або через код:
```javascript
const { getRejectedGrants } = require('./src/lib/db');
const rejected = await getRejectedGrants({ limit: 10 });
console.log(rejected);
```

### Як налаштувати ngrok для розробки?

```bash
# Встановіть ngrok
# Зареєструйтеся на https://ngrok.com
# Отримайте authtoken та налаштуйте:
ngrok config add-authtoken YOUR_AUTHTOKEN

# Запустіть тунель:
ngrok http 3000

# Скопіюйте HTTPS URL та оновіть налаштування Slack
```

### Slack-бот не відповідає на команди

1. Перевірте, чи правильні токени в `.env`
2. Переконайтеся, що Request URL в налаштуваннях Slack використовує HTTPS
3. Перевірте права доступу бота (Bot Token Scopes)
4. Перегляньте логи в консолі на наявність помилок

### Як змінити розклад автоматичного скрапінгу?

Відредагуйте cron-вирази в `src/main.js`:
```javascript
// Щонеділі о 08:00 - скрапінг
cron.schedule('0 8 * * 1', async () => {
    await scrapeAll();
});

// Щонеділі о 09:00 - звіт
cron.schedule('0 9 * * 1', async () => {
    await sendWeeklyGrants();
});
```

### Чому щотижневий звіт порожній?

1. Перевірте, чи були знайдені нові гранти за останній тиждень
2. Переконайтеся, що скрапінг відбувся успішно (перевірте логи)
3. Протестуйте звіт командою: `npm run test-weekly`

### Що означає "нові гранти" у щотижневому звіті?

Нові гранти - це ті, які були додані до бази даних протягом останніх 7 днів (поле `created_at`). Звіт НЕ включає всі гранти з бази, а лише щойно знайдені.


### Як додати нові джерела грантів?

1. Створіть новий скрапер у `src/scrapers/`
2. Розширте `BaseScraper`
3. Додайте до масиву `sources` в `main.js`
4. Протестуйте скрапер окремо
5. Проаналізуйте HTML структуру сайту та створіть зразки в `html samples/`

## Ліцензія

ISC
