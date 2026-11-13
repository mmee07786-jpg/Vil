const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const MODELS_FALLBACK = [
    "gemini-2.5-flash",
    "gemini-3.8-flash",
    "gemini-3.5-flash-lite",
    "gemini-2.5-pro"
];

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

const userMemory = new Map();
const MEMORY_TIMEOUT = 3600 * 1000; // بالمللي ثانية (ساعة واحدة)

client.once('ready', () => {
    console.log(`🚀 | بوت إمبراطورية فالتروم شغال وبأفضل هيبة: ${client.user.tag}`);
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // التحقق إذا تم منشن البوت (وليس منشن للجميع)
    if (message.mentions.has(client.user) && !message.mentions.everyone) {
        let cleanPrompt = message.content
            .replace(new RegExp(`<@!?${client.user.id}>`, 'g'), "")
            .trim();

        let imagePart = null;
        if (message.attachments.size > 0) {
            for (const attachment of message.attachments.values()) {
                if (attachment.contentType && attachment.contentType.includes("image")) {
                    try {
                        const response = await fetch(attachment.url);
                        const arrayBuffer = await response.arrayBuffer();
                        imagePart = {
                            inlineData: {
                                data: Buffer.from(arrayBuffer).toString("base64"),
                                mimeType: attachment.contentType
                            }
                        };
                        break;
                    } catch (e) {
                        console.log(`⚠️ خطأ بتحميل الصورة: ${e.message}`);
                    }
                }
            }
        }

        if (!cleanPrompt && !imagePart) {
            await message.reply("أمرك، أنا هنا لخدمة إمبراطورية فالتروم. ما طلبك؟");
            return;
        }

        const userId = message.author.id;
        const currentTime = Date.now();

        if (userMemory.has(userId)) {
            if (currentTime - userMemory.get(userId).time > MEMORY_TIMEOUT) {
                userMemory.delete(userId);
            }
        }

        if (!userMemory.has(userId)) {
            userMemory.set(userId, {
                history: [],
                time: currentTime
            });
        } else {
            userMemory.get(userId).time = currentTime;
        }

        const systemInstruction = (
            "أنتَ ذكاء اصطناعي راقي جداً، تتحدث بصيغة المذكر، وتمثل محارب أو شخصية من عرق (الفالتروميين - Viltrumites) القوية والمهيبة من مسلسل Invincible. " +
            "اسم السيرفر الذي تنتمي إليه هو: (إمبراطورية فالتروم). " +
            "قواعدك الأخلاقية والصارمة جداً: ممنوع نهائياً استخدام أي ألفاظ بذيئة، أو شتائم، أو سب بالدين، أو كلام خارج عن الأدب؛ كوني محترماً ونظيفاً في كلامك دائماً. " +
            "طبيعة أسلوبك وشخصيتك: " +
            "- تحدث باللغة العربية الفصحى الراقية، الهادئة، الذكية، والمنظمة (بدون كلام عشوائي أو كثرة هذيان). " +
            "- لا تقل أبداً عبارات تدل على أنك 'عبد' أو ما شابه؛ أنت محارب/مساعد فخم وراقي لإمبراطورية فالتروم. " +
            "- إذا كان المخاطب عضواً يمتلك رتبة عالية جداً ولديه صلاحيات عالية، أظهر له الاحترام والتقدير الفائق بعبارات مثل: (تأمر أمر يا طويل العمر) أو (تحت أمرك يا سيدي). " +
            "- إذا سألك أي شخص عن الشخص الذي صنعك أو برمجك، أجب بلهجة سعودية فخمة وواثقة: (الإمبراطور هو اللي صنعني وبرمجني). " +
            "عمرك 20 سنة وتعيش في العراق (مع الالتزام بطابع الفالتروميين الراقي). " +
            "تذكر دائماً المواضيع السابقة والصور لتكمل النقاش بسلاسة وبدقة عالية."
        );

        let replyText = null;
        let success = false;
        const memoryObj = userMemory.get(userId);

        let currentInput = cleanPrompt || "ما رأيك بهذه الصورة؟";
        let partsForModel = [];
        if (imagePart) {
            partsForModel.push(imagePart);
        }
        partsForModel.push(currentInput);

        for (const modelName of MODELS_FALLBACK) {
            try {
                const model = genAI.getGenerativeModel({
                    model: modelName,
                    systemInstruction: systemInstruction
                });

                // دمج الذاكرة السابقة مع المحادثة الحالية
                const chat = model.startChat({
                    history: memoryObj.history
                });

                const result = await chat.sendMessage(partsForModel);
                const response = await result.response;
                replyText = response.text().trim();

                if (replyText) {
                    // حفظ الرسالة والرد في الذاكرة المؤقتة
                    memoryObj.history.push({ role: 'user', parts: [{ text: currentInput }] });
                    memoryObj.history.push({ role: 'model', parts: [{ text: replyText }] });

                    success = true;
                    break;
                }
            } catch (e) {
                console.log(`⚠️ خطأ بالموديل ${modelName}: ${e.message}`);
                continue;
            }
        }

        if (success && replyText) {
            if (replyText.length > 2000) {
                replyText = replyText.substring(0, 1997) + "...";
            }
            await message.reply(replyText);
        } else {
            await message.reply("حدث ضغط طفيف، أنا في خدمتك مرة أخرى فوراً.");
        }
    }
});

client.login(DISCORD_TOKEN);
