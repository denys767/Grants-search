const test = require('node:test');
const assert = require('node:assert/strict');
const BaseScraper = require('../src/scrapers/baseScraper');

test('extractMainArticleText excludes sidebar and recommended content', () => {
  const article = 'Основний опис гранту для навчання підприємців. '.repeat(4);
  const html = `
    <main>
      <article>
        <div class="entry-content"><p>${article}</p><aside>Чужий тендер із сайдбару</aside></div>
        <div class="recommended">Рекомендований грант, який не належить цій сторінці</div>
      </article>
      <aside>Ще один сторонній матеріал</aside>
    </main>`;

  const text = BaseScraper.extractMainArticleText(html);

  assert.match(text, /Основний опис гранту/);
  assert.doesNotMatch(text, /Чужий тендер|Рекомендований грант|сторонній матеріал/);
});

test('extractMainArticleText does not fall back to main or body', () => {
  const html = `<main>${'Навігація та сторонній вміст '.repeat(8)}</main>`;

  assert.equal(BaseScraper.extractMainArticleText(html), '');
});

test('extractMainArticleText supports the EU portal content component only', () => {
  const html = `
    <main>
      <sedia-call-detail>${'Деталі конкурсу Funding & Tenders Portal. '.repeat(4)}</sedia-call-detail>
      <aside>Сторонній елемент порталу</aside>
    </main>`;

  const text = BaseScraper.extractMainArticleText(html);

  assert.match(text, /Деталі конкурсу/);
  assert.doesNotMatch(text, /Сторонній елемент/);
});
