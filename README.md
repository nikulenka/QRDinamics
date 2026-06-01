# QRDinamics

**Dynamic QR Code Manager** — веб-приложение для создания динамических QR-кодов, адрес назначения которых можно менять в любой момент без перепечатки кода.

## Что это такое

Обычный QR-код жёстко зашит на конкретный URL. Если адрес изменился — код устарел. QRDinamics решает эту проблему: каждый сгенерированный QR-код ведёт на короткий внутренний адрес `/q/:id`, а этот адрес уже перенаправляет на нужный destination URL, хранящийся в базе данных. Destination можно менять сколько угодно раз — QR-код при этом остаётся прежним.

## Возможности

- **Создание динамических QR-кодов** — задаёте название и URL назначения, приложение генерирует уникальный короткий ID
- **Редактирование в реальном времени** — смена destination мгновенно вступает в силу для всех уже распечатанных кодов
- **Срок действия** — можно задать дату и время истечения; после этого момента код перестаёт перенаправлять и показывает сообщение об ошибке
- **Счётчик сканирований** — каждое перенаправление инкрементирует счётчик clicks в Firestore
- **Аналитика** — модальное окно с графиком активности за последние 7 дней
- **Экспорт QR-кода** — скачивание в формате PNG или SVG
- **Поиск и фильтрация** — по названию и URL, с фильтром по статусу (все / активные / истёкшие)
- **Аутентификация** — вход через Email + пароль или Google OAuth; каждый пользователь видит только свои коды

## Стек технологий

| Слой | Технологии |
|---|---|
| Frontend | React 19, TypeScript, Vite 6 |
| Стили | Tailwind CSS v4, lucide-react, Motion |
| Роутинг | React Router v7 |
| QR-генерация | `qrcode` (canvas + SVG) |
| Графики | Recharts |
| База данных | Firebase Firestore |
| Аутентификация | Firebase Auth (Email/Password, Google) |

## Архитектура

```
/q/:id  →  Redirect.tsx  →  читает doc из Firestore  →  window.location.href = destination
                                                     →  clicks += 1
```

Каждый QR-код хранится в Firestore как документ коллекции `links`:

```ts
{
  ownerId: string       // uid пользователя
  title: string         // название (необязательно)
  destination: string   // URL назначения
  clicks: number        // счётчик сканирований
  createdAt: Timestamp
  updatedAt: Timestamp
  expiresAt?: string    // ISO дата истечения (необязательно)
}
```

## Структура проекта

```
src/
  App.tsx          — роуты и защита страниц через Firebase Auth
  Auth.tsx         — экран входа/регистрации
  Dashboard.tsx    — основной интерфейс управления кодами
  Redirect.tsx     — страница-редиректор /q/:id
  firebase.ts      — инициализация Firebase
  types.ts         — интерфейс Link
  lib/utils.ts     — утилиты (cn для Tailwind)
```

## Запуск локально

**Требования:** Node.js 18+

1. Клонировать репозиторий:
   ```bash
   git clone https://github.com/nikulenka/QRDinamics
   cd QRDinamics
   ```

2. Установить зависимости:
   ```bash
   npm install
   ```

3. Настроить Firebase:
   - Создайте проект в [Firebase Console](https://console.firebase.google.com)
   - Включите **Firestore Database** и **Authentication** (Email/Password + Google)
   - Заполните `firebase-applet-config.json` своими реквизитами проекта

4. Создать `.env.local` и заполнить переменные из `.env.example`:
   ```bash
   cp .env.example .env.local
   ```

5. Запустить:
   ```bash
   npm run dev
   ```

Приложение будет доступно по адресу `http://localhost:5173`.

## Firestore Security Rules

Правила безопасности хранятся в `firestore.rules`. Краткая схема: пользователь может читать и изменять только свои документы (`ownerId == request.auth.uid`); неаутентифицированные пользователи могут только читать документ по ID (для работы редиректа) и инкрементировать счётчик `clicks`.

## Скрипты

| Команда | Описание |
|---|---|
| `npm run dev` | Запуск в режиме разработки |
| `npm run build` | Сборка для продакшена |
| `npm run preview` | Предпросмотр собранного приложения |
| `npm run lint` | Проверка типов TypeScript |
