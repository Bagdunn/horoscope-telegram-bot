// Підключення необхідних бібліотек
const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');
const { OpenAI } = require('openai');
const cron = require('node-cron');
require('dotenv').config();

// Налаштування OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Налаштування телеграм-бота
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Підключення до MongoDB Atlas
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('MongoDB підключено успішно'))
.catch(err => console.error('MongoDB помилка підключення:', err));

// Схема для бази даних користувачів
const userSchema = new mongoose.Schema({
  chatId: { type: Number, required: true, unique: true },
  zodiacSign: { type: String, required: true },
  language: { type: String, required: true, default: 'en' },
  registrationDate: { type: Date, default: Date.now }
});

// Модель користувача
const User = mongoose.model('User', userSchema);

// Схема для бази даних гороскопів
const horoscopeSchema = new mongoose.Schema({
  zodiacSign: { type: String, required: true },
  text: { type: String, required: true },
  language: { type: String, required: true },
  date: { type: Date, default: Date.now }
});

// Модель гороскопу
const Horoscope = mongoose.model('Horoscope', horoscopeSchema);

// Константи - знаки зодіаку
const ZODIAC_SIGNS = [
  'Овен', 'Телець', 'Близнюки', 'Рак', 
  'Лев', 'Діва', 'Терези', 'Скорпіон', 
  'Стрілець', 'Козеріг', 'Водолій', 'Риби'
];

// Константи - мови
const LANGUAGES = {
  'uk': '🇺🇦 Українська',
  'en': '🇬🇧 English',
  'es': '🇪🇸 Español',
  'ru': '🏳️ Русский'
};

// Функція для генерації гороскопу через OpenAI API
async function generateHoroscope(zodiacSign, language) {
  try {
    const languagePrompts = {
      'uk': 'українською мовою',
      'en': 'in English',
      'es': 'en español',
      'ru': 'на русском языке'
    };

    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { 
          role: "system", 
          content: "Ви - професійний астролог. Створіть позитивний та мотивуючий гороскоп на сьогодні."
        },
        { 
          role: "user", 
          content: `Напишіть детальний гороскоп на сьогодні для знаку ${zodiacSign} ${languagePrompts[language]}. Гороскоп має бути позитивним, мотивуючим і містити поради на день.`
        }
      ],
      max_tokens: 800
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error(`Помилка генерації гороскопу для ${zodiacSign}:`, error);
    return `Вибачте, не вдалося згенерувати гороскоп для ${zodiacSign} сьогодні.`;
  }
}

// Функція для збереження гороскопів у базу даних
async function saveHoroscope(zodiacSign, text, language) {
  try {
    const horoscope = new Horoscope({
      zodiacSign,
      text,
      language,
      date: new Date()
    });
    await horoscope.save();
    console.log(`Гороскоп для ${zodiacSign} (${language}) збережено в базі даних`);
  } catch (error) {
    console.error(`Помилка при збереженні гороскопу для ${zodiacSign}:`, error);
  }
}

// Функція для надсилання гороскопів усім користувачам
async function sendHoroscopesToAllUsers() {
  try {
    // Генерація та збереження гороскопів для всіх знаків та мов
    for (const sign of ZODIAC_SIGNS) {
      for (const [langCode, langName] of Object.entries(LANGUAGES)) {
        const horoscopeText = await generateHoroscope(sign, langCode);
        await saveHoroscope(sign, horoscopeText, langCode);
        
        // Знаходження користувачів з цим знаком зодіаку та мовою
        const users = await User.find({ zodiacSign: sign, language: langCode });
        
        // Надсилання гороскопу цим користувачам
        for (const user of users) {
          try {
            await bot.telegram.sendMessage(
              user.chatId,
              `🌟 *Гороскоп для ${sign} на ${new Date().toLocaleDateString('uk-UA')}* 🌟\n\n${horoscopeText}`,
              { parse_mode: 'Markdown' }
            );
            console.log(`Гороскоп надіслано користувачу ${user.chatId}`);
          } catch (err) {
            console.error(`Помилка надсилання гороскопу користувачу ${user.chatId}:`, err);
          }
        }
      }
    }
    console.log('Розсилка гороскопів завершена');
  } catch (error) {
    console.error('Помилка при розсилці гороскопів:', error);
  }
}

// Команда /start - вітання та пропозиція зареєструватися
bot.start(async (ctx) => {
  await ctx.reply(
    'Welcome! I am a bot that sends daily horoscopes. ' +
    'To receive horoscopes, please register by selecting your preferred language and zodiac sign.',
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Register', callback_data: 'register' }
          ]
        ]
      }
    }
  );
});

// Реєстрація користувача - запит мови
bot.action('register', async (ctx) => {
  // Створення клавіатури з мовами
  const languageKeyboard = {
    inline_keyboard: Object.entries(LANGUAGES).map(([code, name]) => [
      { text: name, callback_data: `lang_${code}` }
    ])
  };
  
  await ctx.editMessageText('Please select your preferred language:', {
    reply_markup: languageKeyboard
  });
});

// Обробка вибору мови
Object.keys(LANGUAGES).forEach(langCode => {
  bot.action(`lang_${langCode}`, async (ctx) => {
    const chatId = ctx.chat.id;
    
    try {
      // Створення клавіатури зі знаками зодіаку
      const zodiacKeyboard = {
        inline_keyboard: ZODIAC_SIGNS.map(sign => [{ text: sign, callback_data: `zodiac_${langCode}_${sign}` }])
      };
      
      await ctx.editMessageText('Please select your zodiac sign:', {
        reply_markup: zodiacKeyboard
      });
    } catch (error) {
      console.error('Помилка при виборі знаку зодіаку:', error);
      await ctx.reply('An error occurred. Please try again later.');
    }
  });
});

// Обробка вибору знаку зодіаку
ZODIAC_SIGNS.forEach(sign => {
  Object.keys(LANGUAGES).forEach(langCode => {
    bot.action(`zodiac_${langCode}_${sign}`, async (ctx) => {
      const chatId = ctx.chat.id;
      
      try {
        // Перевірка, чи користувач вже зареєстрований
        let user = await User.findOne({ chatId });
        
        if (user) {
          // Оновлення існуючого користувача
          user.zodiacSign = sign;
          user.language = langCode;
          await user.save();
          await ctx.editMessageText(`Your profile has been updated:\nZodiac sign: ${sign}\nLanguage: ${LANGUAGES[langCode]}`);
        } else {
          // Створення нового користувача
          user = new User({
            chatId,
            zodiacSign: sign,
            language: langCode
          });
          await user.save();
          await ctx.editMessageText(`You have successfully registered:\nZodiac sign: ${sign}\nLanguage: ${LANGUAGES[langCode]}`);
        }
        
        // Надіслати поточний гороскоп одразу після реєстрації
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // Пошук гороскопу в базі даних за сьогоднішню дату
        let horoscope = await Horoscope.findOne({
          zodiacSign: sign,
          language: langCode,
          date: { $gte: today }
        });
        
        // Якщо гороскоп на сьогодні ще не було згенеровано
        if (!horoscope) {
          const horoscopeText = await generateHoroscope(sign, langCode);
          await saveHoroscope(sign, horoscopeText, langCode);
          horoscope = { text: horoscopeText };
        }
        
        // Надсилання поточного гороскопу
        await ctx.reply(
          `🌟 *Horoscope for ${sign} on ${new Date().toLocaleDateString('en-US')}* 🌟\n\n${horoscope.text}`,
          { parse_mode: 'Markdown' }
        );
      } catch (error) {
        console.error('Помилка при реєстрації користувача:', error);
        await ctx.reply('An error occurred during registration. Please try again later.');
      }
    });
  });
});

// Додаткова команда для зручності реєстрації
bot.command('register', (ctx) => {
  // Створення клавіатури з мовами
  const languageKeyboard = {
    inline_keyboard: Object.entries(LANGUAGES).map(([code, name]) => [
      { text: name, callback_data: `lang_${code}` }
    ])
  };
  
  ctx.reply(
    'Please select your preferred language:',
    {
      reply_markup: languageKeyboard
    }
  );
});

// Команда /profile - перегляд поточного профілю
bot.command('profile', async (ctx) => {
  const chatId = ctx.chat.id;
  
  try {
    const user = await User.findOne({ chatId });
    
    if (user) {
      await ctx.reply(
        `Ваш профіль:\nЗнак зодіаку: ${user.zodiacSign}\nМова: ${LANGUAGES[user.language]}\nДата реєстрації: ${user.registrationDate.toLocaleDateString('uk-UA')}`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Змінити налаштування', callback_data: 'register' }]
            ]
          }
        }
      );
    } else {
      await ctx.reply(
        'Ви ще не зареєстровані. Будь ласка, зареєструйтеся, щоб отримувати гороскопи.',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Зареєструватися', callback_data: 'register' }]
            ]
          }
        }
      );
    }
  } catch (error) {
    console.error('Помилка при отриманні профілю:', error);
    await ctx.reply('Виникла помилка при отриманні вашого профілю. Будь ласка, спробуйте ще раз пізніше.');
  }
});

// Команда /horoscope - отримання поточного гороскопу
bot.command('horoscope', async (ctx) => {
  const chatId = ctx.chat.id;
  
  try {
    const user = await User.findOne({ chatId });
    
    if (user) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Пошук гороскопу в базі даних за сьогоднішню дату
      let horoscope = await Horoscope.findOne({
        zodiacSign: user.zodiacSign,
        language: user.language,
        date: { $gte: today }
      });
      
      // Якщо гороскоп на сьогодні ще не було згенеровано
      if (!horoscope) {
        const horoscopeText = await generateHoroscope(user.zodiacSign, user.language);
        await saveHoroscope(user.zodiacSign, horoscopeText, user.language);
        horoscope = { text: horoscopeText };
      }
      
      await ctx.reply(
        `🌟 *Гороскоп для ${user.zodiacSign} на ${new Date().toLocaleDateString('uk-UA')}* 🌟\n\n${horoscope.text}`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.reply(
        'Ви ще не зареєстровані. Будь ласка, зареєструйтеся, щоб отримувати гороскопи.',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Зареєструватися', callback_data: 'register' }]
            ]
          }
        }
      );
    }
  } catch (error) {
    console.error('Помилка при отриманні гороскопу:', error);
    await ctx.reply('Виникла помилка при отриманні гороскопу. Будь ласка, спробуйте ще раз пізніше.');
  }
});

// Команда /help - відображення допомоги
bot.help((ctx) => {
  ctx.reply(
    'Доступні команди:\n' +
    '/start - Запустити бота\n' +
    '/register - Зареєструватися або змінити налаштування\n' +
    '/profile - Переглянути свій профіль\n' +
    '/horoscope - Отримати сьогоднішній гороскоп\n' +
    '/help - Показати цю довідку'
  );
});

// Відповідь на текстові повідомлення
bot.on('text', (ctx) => {
  ctx.reply(
    'Будь ласка, використовуйте команди для взаємодії з ботом.\n' +
    'Введіть /help для відображення доступних команд.'
  );
});

// Планування щоденної розсилки гороскопів о 8:00 ранку
cron.schedule('0 8 * * *', async () => {
  console.log('Починаємо щоденну розсилку гороскопів...');
  await sendHoroscopesToAllUsers();
});

// Запуск бота
bot.launch()
  .then(() => console.log('Бот запущено'))
  .catch(err => console.error('Помилка запуску бота:', err));

// Обробка завершення роботи
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));