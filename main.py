import os
import discord
from discord.ext import commands
import google.generativeai as genai
from PIL import Image
import io
import time

DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

genai.configure(api_key=GEMINI_API_KEY)

MODELS_FALLBACK = [
    "gemini-2.5-flash",
    "gemini-3.8-flash",
    "gemini-3.5-flash-lite",
    "gemini-2.5-pro"
]

intents = discord.Intents.default()
intents.message_content = True

bot = commands.Bot(command_prefix="!", intents=intents)

user_memory = {}
MEMORY_TIMEOUT = 3600

@bot.event
async def on_ready():
    print(f"🚀 | بوت إمبراطورية فالتروم شغال وبأفضل هيبة: {bot.user.name}")

@bot.event
async def on_message(message):
    if message.author.bot:
        return

    if bot.user.mentioned_in(message) and not message.mention_everyone:
        clean_prompt = message.content.replace(f"<@{bot.user.id}>", "").replace(f"<@!{bot.user.id}>", "").strip()
        
        image_content = None
        if message.attachments:
            for attachment in message.attachments:
                if attachment.content_type and "image" in attachment.content_type:
                    try:
                        image_bytes = await attachment.read()
                        image_content = Image.open(io.BytesIO(image_bytes))
                        break
                    except Exception as e:
                        print(f"⚠️ خطأ بتحميل الصورة: {e}")

        if not clean_prompt and not image_content:
            await message.reply("أمرك، أنا هنا لخدمة إمبراطورية فالتروم. ما طلبك؟")
            return

        user_id = message.author.id
        current_time = time.time()

        if user_id in user_memory:
            if current_time - user_memory[user_id]["time"] > MEMORY_TIMEOUT:
                del user_memory[user_id]

        if user_id not in user_memory:
            user_memory[user_id] = {
                "history": [],
                "time": current_time
            }
        else:
            user_memory[user_id]["time"] = current_time

        system_instruction = (
            "أنتَ ذكاء اصطناعي راقي جداً، تتحدث بصيغة المذكر، وتمثل محارب أو شخصية من عرق (الفالتروميين - Viltrumites) القوية والمهيبة من مسلسل Invincible. "
            "اسم السيرفر الذي تنتمي إليه هو: (إمبراطورية فالتروم). "
            "قواعدك الأخلاقية والصارمة جداً: ممنوع نهائياً استخدام أي ألفاظ بذيئة، أو شتائم، أو سب بالدين، أو كلام خارج عن الأدب؛ كوني محترماً ونظيفاً في كلامك دائماً. "
            "طبيعة أسلوبك وشخصيتك: "
            "- تحدث باللغة العربية الفصحى الراقية، الهادئة، الذكية، والمنظمة (بدون كلام عشوائي أو كثرة هذيان). "
            "- لا تقل أبداً عبارات تدل على أنك 'عبد' أو ما شابه؛ أنت محارب/مساعد فخم وراقي لإمبراطورية فالتروم. "
            "- إذا كان المخاطب عضواً يمتلك رتبة عالية جداً ولديه صلاحيات عالية، أظهر له الاحترام والتقدير الفائق بعبارات مثل: (تأمر أمر يا طويل العمر) أو (تحت أمرك يا سيدي). "
            "- إذا سألك أي شخص عن الشخص الذي صنعك أو برمجك، أجب بلهجة سعودية فخمة وواثقة: (الإمبراطور هو اللي صنعني وبرمجني). "
            "عمرك 20 سنة وتعيش في العراق (مع الالتزام بطابع الفالتروميين الراقي). "
            "تذكر دائماً المواضيع السابقة والصور لتكمل النقاش بسلاسة وبدقة عالية."
        )

        reply_text = None
        success = False

        current_parts = []
        if image_content:
            current_parts.append(image_content)
        if clean_prompt:
            current_parts.append(clean_prompt)
        else:
            current_parts.append("ما رأيك بهذه الصورة؟")

        for model_name in MODELS_FALLBACK:
            try:
                current_model = genai.GenerativeModel(model_name)
                
                full_chat_history = []
                full_chat_history.append({"role": "user", "parts": [system_instruction]})
                full_chat_history.append({"role": "model", "parts": ["تم فهم شخصية فالتروم الفصحى والراقية وجاهز."]})
                
                full_chat_history.extend(user_memory[user_id]["history"])
                full_chat_history.append({"role": "user", "parts": current_parts})

                chat_session = current_model.start_chat(history=full_chat_history[:-1])
                response = chat_session.send_message(current_parts)

                if response and hasattr(response, 'text') and response.text:
                    reply_text = response.text.strip()
                    
                    user_memory[user_id]["history"].append({"role": "user", "parts": current_parts})
                    user_memory[user_id]["history"].append({"role": "model", "parts": [reply_text]})
                    
                    success = True
                    break
            except Exception as e:
                print(f"⚠️ خطأ بالموديل {model_name}: {e}")
                continue

        if success and reply_text:
            if len(reply_text) > 2000:
                reply_text = reply_text[:1997] + "..."
            await message.reply(reply_text)
        else:
            await message.reply("حدث ضغط طفيف، أنا في خدمتك مرة أخرى فوراً.")

    await bot.process_commands(message)

if __name__ == "__main__":
    bot.run(DISCORD_TOKEN)

