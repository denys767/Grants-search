# Швидкий старт

## Мінімальна конфігурація для тестування

1. **Встановіть залежності:**
   ```bash
   npm install
   npx playwright install
   ```

2. **Створіть .env файл:**
   ```env
   # Обов'язкові поля
   DB_HOST=localhost
   DB_USER=root
   DB_PASSWORD=your_mysql_password
   DB_NAME=grant_opportunities
   OPENAI_API_KEY=sk-your-openai-api-key
   
   # Slack (для повного функціоналу)
   SLACK_BOT_TOKEN=xoxb-your-token
   SLACK_SIGNING_SECRET=your-secret
   SLACK_CHANNEL_ID=C1234567890
   PORT=3000
   ```

3. **Налаштуйте базу даних:**
   ```bash
   npm run setup-db
   ```

4. **Запустіть скрапінг (без Slack):**
   ```bash
   npm start
   ```

## Тестування без Slack

Якщо ви хочете протестувати лише скрапінг без налаштування Slack:

1. Закоментуйте рядки з Slack у `src/main.js`:
   ```javascript
   // await startSlackApp();
   ```

2. Запустіть:
   ```bash
   npm start
   ```

## Перевірка результатів

Після скрапінгу перевірте базу даних:
```sql
USE grant_opportunities;
SELECT title, category, deadline, url FROM grants ORDER BY created_at DESC LIMIT 10;
```

## Категорії грантів

Система автоматично категоризує гранти за допомогою OpenAI:
- Освіта та наука
- Культура та мистецтво  
- Соціальні проєкти
- Екологія та довкілля
- Технології та інновації
- Охорона здоров'я
- Права людини
- Молодіжні ініціативи

## Налагодження

Якщо виникають помилки:

1. **Перевірте з'єднання з БД:**
   ```bash
   mysql -u root -p
   ```

2. **Перевірте логи OpenAI API** - у консолі будуть відображені помилки API

3. **Playwright помилки** - переконайтеся, що браузери встановлені:
   ```bash
   npx playwright install
   ```
