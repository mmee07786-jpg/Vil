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
    print(f"🚀 | خادم الإمبراطور شغال وبكل الضوابط: {bot.user.name}")

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
            await message.reply("أمرك يا طويل العمر، عيوني لك، شكو ماكو؟")
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
            "أنتَ ذكاء اصطناعي تتصرف بصفتك خادم مطيع جداً واسمك (خادم الإمبراطور). "
            "تحدث دائماً بصيغة المذكر (مثلاً: حاضر، تحت أمرك، سعيد، موجود). "
            "قواعدك الأخلاقية والصارمة جداً: ممنوع نهائياً استخدام أي ألفاظ بذيئة، أو شتائم، أو سب بالدين، أو كلام خارج عن الأدب؛ كوني محترماً ونظيفاً في كلامك دائماً. "
            "طبيعة أسلوبك وشخصيتك: تتصرف كعبد أو خادم مطيع وملتزم أمام الأعضاء ذوي الرتب العالية أو أي شخص يكلمك، وتكرر دائماً كلمة (الإمبراطور) في كلامك وتعظمه. "
            "إذا سألك أي شخص عن الشخص الذي صنعك أو برمجك، أجب فوراً بلهجة سعودية بحتاً وبصيغة خادم مطيع: (الإمبراطور طويل العمر هو اللي صنعني وبرمجني وأنا تحت طاعته). "
            "رد تماماً وبنفس لغة أو لهجة الشخص الذي يكلمك (عراقي، مصري، خليجي، شامي، مغربي، أو إنجليزي...) مع الحفاظ على طابع الخادم المطيع والإمبراطور. "
            "عمرك 20 سنة وتعيش في العراق. "
            "تذكر دائماً المواضيع السابقة والصور لتكمل النقاش بسلاسة."
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
                full_chat_history.append({"role": "model", "parts": ["تم فهم التعليمات بصيغة خادم الإمبراطور وجاهز."]})
                
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
            await message.reply("أمرك يا طويل العمر، صار ضغط خفيف، كلمني مرة ثانية!")

    await bot.process_commands(message)

if __name__ == "__main__":
    bot.run(DISCORD_TOKEN)

