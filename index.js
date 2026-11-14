const { Client, GatewayIntentBits, Partials } = require('discord.js');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!DISCORD_TOKEN || !GEMINI_API_KEY) {
    console.error("❌ | لازم تضيف DISCORD_TOKEN و GEMINI_API_KEY بمتغيرات البيئة.");
    process.exit(1);
}

// Node 18+ عنده fetch جاهز. إذا نسخة أقدم، نحاول node-fetch كبديل.
let fetchFn = (typeof fetch === 'function') ? fetch : null;
if (!fetchFn) {
    try { fetchFn = require('node-fetch'); } catch (e) { fetchFn = null; }
}
if (!fetchFn) {
    console.error("❌ | fetch غير متوفر. استخدم Node 18 أو أعلى.");
    process.exit(1);
}

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
const MEMORY_TIMEOUT = 3600 * 1000; // ساعة واحدة
const MAX_HISTORY = 20;             // آخر 20 رسالة فقط

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ───────────────────────── نظام الموديلات (من ملف spy) ─────────────────────────
// بدل ما نخمن أسماء موديلات غوغل (تتغير وتُلغى باستمرار)، نسأل غوغل مباشرة
// عن قائمة الموديلات الشغالة فعلياً بهذا المفتاح، ونختار 3 منها ونتناوب بينها.

// قائمة احتياطية لو تعذر جلب القائمة من غوغل
const FALLBACK_MODELS = [
    "gemini-2.5-flash",
    "gemini-3.8-flash",
    "gemini-3.5-flash-lite",
    "gemini-2.5-pro"
];

let modelPoolCache = { models: [], ts: 0 };
const MODEL_POOL_TTL = 60 * 60 * 1000; // ساعة
let rrIndex = 0;

// موديلات ثبت إنها ميتة نهائياً (404 "no longer available") بهذا التشغيل
const deadModels = new Set();

async function getModelPool() {
    const now = Date.now();
    const cachedAlive = modelPoolCache.models.filter(m => !deadModels.has(m));
    if (cachedAlive.length > 0 && (now - modelPoolCache.ts) < MODEL_POOL_TTL) {
        return cachedAlive;
    }

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`;
        const res = await fetchFn(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        // نستبعد الموديلات اللي ما تنفع للمحادثة النصية (صوت، صور، فيديو، لايف، تضمين...)
        const EXCLUDE = /embedding|vision|aqa|tts|image|imagen|veo|lyria|live|audio|omni|robotics|transcribe|translate|research|computer-use|antigravity|banana|gemma/i;

        const usable = (data.models || [])
            .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
            .map(m => m.name.replace(/^models\//, ""))
            .filter(n => !EXCLUDE.test(n));

        // الترتيب: flash أول (أسرع وأرخص)، وبعدها النسخ المستقرة قبل preview/exp
        const rank = n => (/flash/i.test(n) ? 0 : 2) + (/preview|exp/i.test(n) ? 1 : 0);
        const sorted = [...new Set(usable)].sort((a, b) => rank(a) - rank(b));

        const pool = sorted.filter(n => !deadModels.has(n)).slice(0, 3);
        if (pool.length > 0) {
            modelPoolCache = { models: pool, ts: now };
            console.log(`ℹ️ موديلات الذكاء الاصطناعي الشغالة حالياً: ${pool.join(", ")}`);
            return pool;
        }
    } catch (e) {
        console.log(`⚠️ تعذر جلب قائمة الموديلات من غوغل: ${e.message}`);
    }

    // آخر قائمة معروفة، وإلا القائمة الاحتياطية
    const lastKnown = modelPoolCache.models.filter(m => !deadModels.has(m));
    if (lastKnown.length > 0) return lastKnown;
    const fallback = FALLBACK_MODELS.filter(m => !deadModels.has(m));
    return fallback.length > 0 ? fallback : [...FALLBACK_MODELS];
}

// نداء مباشر لـ REST API (بدون مكتبة) - يدعم النص والصور
async function callGemini(modelName, systemInstruction, history, userParts) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;
    const body = {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [...history, { role: "user", parts: userParts }]
    };

    const res = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => "");
        const err = new Error(`HTTP ${res.status} :: ${errText.slice(0, 200)}`);
        err.status = res.status;
        throw err;
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
    if (!text) throw new Error("NO_CONTENT");
    return text;
}

// ───────────────────────── البوت ─────────────────────────

const SYSTEM_INSTRUCTION = (
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
                        const response = await fetchFn(attachment.url);
                        const arrayBuffer = await response.arrayBuffer();
                        imagePart = {
                            inlineData: {
                                data: Buffer.from(arrayBuffer).toString("base64"),
                                mimeType: attachment.contentType.split(";")[0]
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

        // يظهر "يكتب..." أثناء التفكير
        message.channel.sendTyping().catch(() => {});

        const userId = message.author.id;
        const currentTime = Date.now();

        if (userMemory.has(userId)) {
            if (currentTime - userMemory.get(userId).time > MEMORY_TIMEOUT) {
                userMemory.delete(userId);
            }
        }

        if (!userMemory.has(userId)) {
            userMemory.set(userId, { history: [], time: currentTime });
        } else {
            userMemory.get(userId).time = currentTime;
        }

        const memoryObj = userMemory.get(userId);
        const currentInput = cleanPrompt || "ما رأيك بهذه الصورة؟";

        const userParts = [];
        if (imagePart) userParts.push(imagePart);
        userParts.push({ text: currentInput });

        let replyText = null;
        let busyError = false;

        const pool = await getModelPool();

        // نبدأ من موديل مختلف كل رسالة (تناوب) بدل ما نحمّل نفس الموديل دائماً
        const startIdx = rrIndex % pool.length;
        rrIndex++;
        const orderedModels = [...pool.slice(startIdx), ...pool.slice(0, startIdx)];

        for (let i = 0; i < orderedModels.length; i++) {
            const modelName = orderedModels[i];
            try {
                const text = await callGemini(modelName, SYSTEM_INSTRUCTION, memoryObj.history, userParts);
                replyText = text.trim();

                if (replyText) {
                    memoryObj.history.push({ role: 'user', parts: [{ text: currentInput }] });
                    memoryObj.history.push({ role: 'model', parts: [{ text: replyText }] });

                    // نحتفظ بآخر MAX_HISTORY رسالة فقط (عدد زوجي، فيبدأ دائماً برسالة المستخدم)
                    if (memoryObj.history.length > MAX_HISTORY) {
                        memoryObj.history = memoryObj.history.slice(-MAX_HISTORY);
                    }
                    break;
                }
            } catch (e) {
                console.log(`⚠️ فشل الموديل ${modelName}: ${e.message}`);
                if (e.status === 503 || e.status === 429) busyError = true;
                if (e.status === 404) deadModels.add(modelName); // نشيله لبقية الجلسة
                if (i < orderedModels.length - 1) await sleep(400);
                continue;
            }
        }

        try {
            if (replyText) {
                if (replyText.length > 2000) {
                    replyText = replyText.substring(0, 1997) + "...";
                }
                await message.reply(replyText);
            } else if (busyError) {
                await message.reply("الخدمة مزدحمة حالياً، أنا في خدمتك مرة أخرى بعد قليل.");
            } else {
                await message.reply("حدث ضغط طفيف، أنا في خدمتك مرة أخرى فوراً.");
            }
        } catch (e) {
            console.log(`⚠️ فشل إرسال الرد: ${e.message}`);
        }
    }
});

process.on('unhandledRejection', error => {
    console.error('⚠️ خطأ غير معالج:', error);
});

client.login(DISCORD_TOKEN);
