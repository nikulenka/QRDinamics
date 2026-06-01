# ТЗ 2.0 — Telegram-бот для QRDinamics

## Цель

Добавить Telegram-бота, который полностью дублирует функционал веб-приложения:
создание / редактирование / удаление динамических QR-кодов, просмотр статистики
и скачивание QR-изображений. Пользователь идентифицируется по Telegram User ID,
данные хранятся в том же Firebase Firestore.

**Ключевая концепция — динамические QR-коды:**
QR-код после печати менять не нужно. Он всегда ведёт на фиксированный адрес
`APP_URL/q/:id`, а тот в реальном времени читает destination из Firestore и
перенаправляет туда. Смена destination — мгновенная, без перепечатки кода.
Это главная ценность продукта, и бот должен делать эту операцию максимально
быстрой и заметной.

**Монетизация:**
- 5 QR-кодов — бесплатно (при первом `/start`)
- Дополнительные коды — пакетами по 5 штук за 5 Telegram Stars

---

## 1. Новые зависимости

Добавить в `package.json`:

```json
"telegraf": "^4.16.3",
"firebase-admin": "^12.0.0"
```

`telegraf` — современный TypeScript-совместимый фреймворк для Telegram Bot API.  
`firebase-admin` — для серверного доступа к Firestore в обход клиентских security rules.

---

## 2. Переменные окружения

Добавить в `.env` (и обновить `.env.example`):

```env
# Telegram Bot
TELEGRAM_BOT_TOKEN=           # токен из @BotFather
TELEGRAM_WEBHOOK_SECRET=      # произвольная строка для верификации webhook (опционально)

# Firebase Admin (сервисный аккаунт)
FIREBASE_PROJECT_ID=          # тот же проект, что в firebase-applet-config.json
FIREBASE_CLIENT_EMAIL=        # email сервисного аккаунта Firebase
FIREBASE_PRIVATE_KEY=         # приватный ключ (с \n, в кавычках)
FIREBASE_DATABASE_ID=         # id базы Firestore (из firebase-applet-config.json → firestoreDatabaseId)

# Публичный URL приложения (для формирования QR-ссылок /q/:id)
APP_URL=                      # например https://qrdinamics.com
```

---

## 3. Структура новых файлов

```
bot/
  index.ts          — точка входа, инициализация Telegraf, регистрация middleware и команд
  firebase.ts       — инициализация Firebase Admin SDK
  quota.ts          — логика квоты: проверка лимита, начисление после оплаты
  commands/
    start.ts        — /start
    list.ts         — /list
    new.ts          — /new (multi-step диалог)
    seturl.ts       — /seturl (ГЛАВНАЯ фича: быстрая смена destination без перепечатки QR)
    edit.ts         — /edit (изменить название или срок действия)
    delete.ts       — /delete
    qr.ts           — /qr (отправить изображение кода)
    stats.ts        — /stats
    buy.ts          — /buy (инициация платежа)
  scenes/
    newQrScene.ts   — Telegraf Scenes Wizard для создания QR
    setUrlScene.ts  — Telegraf Scenes Wizard для смены URL (2 шага: выбор кода → новый URL)
    editQrScene.ts  — Telegraf Scenes Wizard для редактирования названия / срока
  keyboards.ts      — InlineKeyboard-фабрики (переиспользуемые клавиатуры)
  types.ts          — TgUser, TgContext и прочие типы
```

Добавить в `package.json`:

```json
"scripts": {
  "bot": "tsx bot/index.ts",
  "bot:dev": "tsx watch bot/index.ts"
}
```

---

## 4. Изменения в Firestore

### 4.1 Новая коллекция `tg_users`

Документ с ID = строковый Telegram User ID.

```ts
interface TgUser {
  telegramId: number
  username?: string       // Telegram username без @
  firstName: string
  freeQuota: number       // всегда 5, задаётся при создании
  purchasedQuota: number  // начинается с 0, растёт после оплаты
  createdAt: Timestamp
}
```

Поле `usedCount` специально не хранится — вычисляется запросом `count()` к `links`
по `ownerId == "tg_" + telegramId`.

### 4.2 Ссылки в коллекции `links`

QR-коды бота хранятся в той же коллекции `links`.
`ownerId` принимает вид `"tg_" + telegramId` (например `"tg_123456789"`).

Никаких изменений схемы документа не требуется — структура совместима.

### 4.3 Обновление `firestore.rules`

Добавить правило для коллекции `tg_users`, чтобы боковой серверный SDK мог
читать/писать её без аутентификации Firebase Auth:

```
// tg_users — доступ только с сервера (Firebase Admin обходит rules автоматически)
// Клиентский доступ закрыт
match /tg_users/{userId} {
  allow read, write: if false;
}
```

Правила для `links` менять **не нужно** — бот работает через Firebase Admin SDK,
который игнорирует security rules полностью.

---

## 5. Логика квоты (`bot/quota.ts`)

```ts
// Получить или создать TgUser
async function getOrCreateUser(ctx): Promise<TgUser>

// Проверить, может ли пользователь создать ещё один QR
async function canCreateQr(telegramId: number): Promise<boolean>
// canCreateQr = usedCount < freeQuota + purchasedQuota

// Подсчитать уже созданные QR
async function countUserQrs(telegramId: number): Promise<number>
// db.collection('links').where('ownerId', '==', 'tg_' + telegramId).count()

// Начислить квоту после успешной оплаты
async function addPurchasedQuota(telegramId: number, amount: number): Promise<void>
// increment(purchasedQuota, amount)
```

---

## 6. Команды бота

### `/start`

1. Если пользователь новый — создаёт документ в `tg_users` (freeQuota: 5, purchasedQuota: 0).
2. Отправляет приветствие с именем пользователя.
3. Показывает текущую квоту: `Использовано: X / Y QR-кодов`.
4. Прикрепляет главное меню (InlineKeyboard):

```
[ ➕ Новый QR ]   [ 📋 Мои коды ]
[ 💰 Купить ещё ] [ ❓ Помощь   ]
```

---

### `/list`

1. Загружает все `links` пользователя из Firestore, сортирует по `createdAt` DESC.
2. Если кодов нет — сообщение «У вас пока нет QR-кодов» + кнопка «➕ Создать».
3. Если коды есть — для каждого выводит карточку:

```
📌 Название (или «Без названия»)
🔗 /q/DOCID
➡️ https://destination.url
📊 Сканирований: N
🟢 Активен  |  или  🔴 Истёк: ДД.ММ.ГГГГ
```

Под каждой карточкой — InlineKeyboard:
```
[ 🔗 Сменить URL ]  ← главная кнопка, вынесена отдельно
[ 🖼 QR ] [ ✏️ Ещё ] [ 📊 Статистика ] [ 🗑 Удалить ]
```

`🔗 Сменить URL` — запускает `setUrlScene` сразу для этого кода (шаг выбора пропускается).  
`✏️ Ещё` — открывает меню редактирования названия и срока действия.

При большом числе кодов (> 5) — пагинация через `offset`/`limit` с кнопками
«← Назад» / «Вперёд →».

---

### `/new` — Wizard-сцена (3 шага)

**Шаг 1 — URL назначения**
```
Отправьте URL, на который будет вести QR-код.
Пример: https://yoursite.com/page
```
Валидация: `new URL(input)` — не бросает исключение. При ошибке — повтор.

**Шаг 2 — Название (необязательно)**
```
Введите название для QR-кода (например «Летняя акция»).
Или нажмите «Пропустить».
```
InlineKeyboard: `[ Пропустить ]`

**Шаг 3 — Срок действия (необязательно)**
```
Укажите дату истечения в формате ДД.ММ.ГГГГ ЧЧ:ММ.
Или нажмите «Без срока».
```
InlineKeyboard: `[ Без срока ]`  
Валидация: `new Date(parsed)` — валидная дата в будущем. При ошибке — повтор.

**Завершение:**
1. Проверить квоту через `canCreateQr`. Если лимит исчерпан:
   ```
   ⛔ Вы использовали все 5 бесплатных QR-кодов.
   Докупить 5 кодов за 5 ⭐ → /buy
   ```
   Выход из сцены.

2. Создать документ в `links` с `ownerId: "tg_" + telegramId`.

3. Сгенерировать QR-изображение (PNG, 512×512):
   ```ts
   import QRCode from 'qrcode'
   const buffer = await QRCode.toBuffer(`${APP_URL}/q/${docId}`, {
     width: 512, margin: 2,
     color: { dark: '#000000', light: '#ffffff' }
   })
   ```

4. Отправить фото с подписью:
   ```
   ✅ QR-код создан!
   📌 Летняя акция
   🔗 https://APP_URL/q/DOCID
   ➡️ https://destination.url
   ```
   Кнопки: `[ 🖼 Скачать PNG ] [ 🔗 Скопировать ссылку ]`

---

### `/seturl` — Wizard-сцена (2 шага) ⭐ ГЛАВНАЯ ФИЧА

Самая важная команда. Позволяет мгновенно сменить URL назначения уже
распечатанного QR-кода — сам код при этом не меняется.

**Шаг 1 — выбор кода**
Если у пользователя 1 код — выбирается автоматически, шаг пропускается.  
Если несколько — InlineKeyboard со списком:
```
📌 Летняя акция  →  https://old-url.com
📌 Визитка       →  https://site.com
```

**Шаг 2 — новый URL**
```
Текущий адрес:
➡️ https://old-destination.com

Отправьте новый URL:
```
Валидация: `new URL(input)`, только `http:` / `https:`. При ошибке — повтор.

**Завершение:**
1. `updateDoc(doc(db, 'links', id), { destination: newUrl, updatedAt: serverTimestamp() })`
2. Подтверждение с акцентом на суть динамических кодов:
```
✅ Адрес обновлён!

📌 Летняя акция
Было: https://old-destination.com
Стало: https://new-destination.com

QR-код перепечатывать не нужно —
он уже ведёт на новый адрес.
```
Кнопки: `[ 📋 Все коды ] [ ➕ Новый QR ]`

---

### `/edit` — Wizard-сцена (название и срок)

Редактирование метаданных кода. URL здесь не меняется — для этого есть `/seturl`.

**Шаг 1 — выбор кода**
Если у пользователя 1 код — выбирается автоматически.  
Если несколько — InlineKeyboard со списком названий / ID.

**Шаг 2 — что редактировать**
InlineKeyboard:
```
[ 📌 Изменить название ]
[ 📅 Изменить срок действия ]
[ ❌ Отмена ]
```

**Шаг 3 — ввод нового значения**
Запрос соответствующего значения с валидацией (как в `/new`).

**Завершение:**
1. `updateDoc` с новым значением + `updatedAt: serverTimestamp()`.
2. Подтверждение: «✅ Код обновлён».

---

### `/delete`

1. Показать список кодов пользователя (InlineKeyboard).
2. После выбора — запрос подтверждения:
   ```
   Удалить «Летняя акция»?
   [ ✅ Да, удалить ] [ ❌ Отмена ]
   ```
3. `deleteDoc` + сообщение «🗑 Удалено».

---

### `/qr <id>` или через кнопку из `/list`

1. Найти документ по ID (проверить `ownerId`).
2. Сгенерировать PNG-буфер.
3. Отправить как `sendDocument` (PNG-файл) с именем `qr-{id}.png`.

---

### `/stats <id>` или через кнопку из `/list`

Вывести текстовую сводку:
```
📊 Статистика: Летняя акция
🔗 https://APP_URL/q/DOCID
➡️ https://destination.url
📈 Всего сканирований: 42
📅 Создан: 01.06.2026
✏️ Обновлён: 05.06.2026
🟢 Статус: Активен
```

> Примечание: детальная разбивка по дням (график) — задача следующей версии.
> Сейчас доступен только суммарный счётчик `clicks` из Firestore.

---

### `/buy`

1. Отправить описание товара и инвойс через `sendInvoice`:

```ts
await ctx.telegram.sendInvoice(chatId, {
  title: '5 QR-кодов',
  description: 'Пакет из 5 дополнительных динамических QR-кодов',
  payload: `qr_pack_5_${telegramId}`,
  provider_token: '',      // пустая строка для Telegram Stars
  currency: 'XTR',         // XTR = Telegram Stars
  prices: [{ label: '5 QR-кодов', amount: 5 }],   // 5 Stars
})
```

2. Обработать `pre_checkout_query`:
```ts
bot.on('pre_checkout_query', async (ctx) => {
  await ctx.answerPreCheckoutQuery(true)
})
```

3. Обработать `successful_payment`:
```ts
bot.on('message', async (ctx) => {
  if (ctx.message.successful_payment) {
    const telegramId = ctx.from.id
    await addPurchasedQuota(telegramId, 5)
    await ctx.reply('✅ Оплата прошла! Вам начислено +5 QR-кодов.\nСоздайте новый код командой /new')
  }
})
```

---

## 7. Telegram Stars — технические детали

- Валюта: `XTR` (Telegram Stars)
- `provider_token`: пустая строка `""` (Stars не требуют платёжного провайдера)
- `amount` в `prices`: целое число Stars (без копеек)
- Рефанды: Telegram Stars можно вернуть через `refundStarPayment` — реализовывать по необходимости

**Прайс-лист (расширяемый):**

| Пакет | Stars | QR-кодов |
|-------|-------|----------|
| Стартер | 5 ⭐ | +5 |
| *(планируется)* Бизнес | 20 ⭐ | +25 |

---

## 8. Запуск бота

### Режим разработки (polling)
```ts
// bot/index.ts
bot.launch({ polling: true })
```
```bash
npm run bot:dev
```

### Продакшн (webhook через Express)
```ts
// bot/index.ts
const app = express()
app.use(express.json())
app.use(bot.webhookCallback('/bot'))
bot.telegram.setWebhook(`${APP_URL}/bot`, {
  secret_token: process.env.TELEGRAM_WEBHOOK_SECRET
})
app.listen(3000)
```

В polling-режиме и webhook-режиме код бота идентичен;
переключение — через `BOT_MODE=webhook|polling` в `.env`.

---

## 9. Инициализация Firebase Admin (`bot/firebase.ts`)

```ts
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const app = initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  })
})

export const db = getFirestore(app, process.env.FIREBASE_DATABASE_ID)
```

Firebase Admin SDK обходит Firestore security rules полностью.
Проверка `ownerId` выполняется в коде бота вручную.

---

## 10. Безопасность

- **Проверка владельца** — перед любой операцией с `links` верифицировать, что `ownerId == "tg_" + ctx.from.id`.
- **Rate limiting** — ограничить создание QR-кодов: не более 10 запросов/мин на пользователя (in-memory Map с timestamp).
- **Валидация URL** — `new URL(input)` + проверка протокола (только `http:` / `https:`).
- **Инвойс payload** — включать `telegramId` в `payload`, сверять при `successful_payment`.
- **TELEGRAM_WEBHOOK_SECRET** — передавать в заголовке `X-Telegram-Bot-Api-Secret-Token`, проверять в middleware.

---

## 11. Обновить `.env.example`

```env
# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
TELEGRAM_WEBHOOK_SECRET=random_secret_string
BOT_MODE=polling

# Firebase Admin SDK
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_DATABASE_ID=(default)

# Публичный URL (для QR-ссылок)
APP_URL=https://your-deployed-app.com
```

---

## 12. Чеклист реализации

- [ ] Установить `telegraf` и `firebase-admin`
- [ ] Обновить `.env.example`
- [ ] Создать `bot/firebase.ts` — Firebase Admin init
- [ ] Создать `bot/types.ts` — TgUser, расширенный TgContext
- [ ] Создать `bot/quota.ts` — getOrCreateUser, canCreateQr, countUserQrs, addPurchasedQuota
- [ ] Создать `bot/keyboards.ts` — главное меню, карточка QR
- [ ] Реализовать `bot/commands/start.ts`
- [ ] Реализовать `bot/commands/list.ts` с пагинацией
- [ ] Реализовать `bot/scenes/newQrScene.ts` (Wizard, 3 шага)
- [ ] Реализовать `bot/scenes/setUrlScene.ts` (Wizard, 2 шага: выбор кода → новый URL)
- [ ] Реализовать `bot/scenes/editQrScene.ts` (Wizard, только название и срок)
- [ ] Реализовать `bot/commands/delete.ts` с подтверждением
- [ ] Реализовать `bot/commands/qr.ts` — генерация PNG буфером
- [ ] Реализовать `bot/commands/stats.ts`
- [ ] Реализовать `bot/commands/buy.ts` — sendInvoice + pre_checkout + successful_payment
- [ ] Создать `bot/index.ts` — точка входа, launch polling/webhook
- [ ] Обновить `firestore.rules` — добавить `tg_users` правило
- [ ] Добавить скрипты `bot` и `bot:dev` в `package.json`
