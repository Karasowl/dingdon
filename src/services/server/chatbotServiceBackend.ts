// app/lib/chatbot/chatbotServiceBackend.ts

import axios from 'axios';
import { ChatbotConfig, Message } from '@/types/chatbot';
import { supabaseAdmin } from '@/lib/supabase/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Interfaz que incluye tanto la base de conocimiento como la config de IA
interface WorkspaceFullConfig extends ChatbotConfig {
  ai_model: string;
  ai_api_key_name: string | null;
}

/**
 * Obtiene la configuración de conocimiento específica de un workspace desde Supabase.
 * @param {string} workspaceId - El ID del workspace.
 * @returns {Promise<ChatbotConfig | null>} La configuración o null si no se encuentra.
 */
async function getWorkspaceConfig(workspaceId: string): Promise<WorkspaceFullConfig | null> {
  const { data, error } = await supabaseAdmin
    .from('workspaces')
    .select('knowledge_base, ai_model, ai_api_key_name')
    .eq('id', workspaceId)
    .single();

  if (error || !data?.knowledge_base) {
    console.error(`No se pudo obtener la configuración para el workspace ${workspaceId}:`, error);
    return null;
  }
  // La columna 'knowledge_base' es de tipo JSONB, por lo que es un objeto directamente.
  return {
    ...(data.knowledge_base as ChatbotConfig), // La base de conocimiento
    ai_model: data.ai_model || 'gemini-2.0-flash', // Fallback al modelo por defecto
    ai_api_key_name: data.ai_api_key_name, // El nombre de referencia de la clave
  };
}

/**
 * Busca una respuesta predefinida en la base de conocimiento cargada.
 * @param {string} userQuery - La pregunta del usuario.
 * @param {ChatbotConfig} config - La configuración del workspace.
 * @returns {string | null} La respuesta encontrada o null.
 */
function findLocalAnswer(userQuery: string, config: ChatbotConfig): string | null {
  const normalizedQuery = userQuery.toLowerCase().trim();
  for (const qa of config.commonQuestions) {
    // Mantenemos la búsqueda simple por ahora.
    if (normalizedQuery.includes(qa.question.toLowerCase().substring(0, 20))) {
      return qa.answer;
    }
  }
  return null;
}

/**
 * Genera el prompt de contexto para la IA usando la configuración dinámica.
 * @param {ChatbotConfig} config - La configuración del workspace.
 * @param {string} userPrompt - La pregunta del usuario.
 * @returns {string} El prompt completo para la IA.
 */
function generateAIContext(config: ChatbotConfig, userPrompt: string, language: string, history: Message[]): string {
  const formattedQA = config.commonQuestions.map(qa => `Q: ${qa.question}\nA: ${qa.answer}`).join('\n\n');

  const conversationHistory = history.map(msg => {
    if (msg.role === 'user') return `User: ${msg.content}`;
    if (msg.role === 'assistant') return `Bot: ${msg.content}`;
    if (msg.role === 'agent') return `Human Agent${msg.agentName ? ` (${msg.agentName})` : ''}: ${msg.content}`;
    return ''; // Ignorar otros roles (system)
  }).filter(Boolean).join(`\n`);

  console.log("HISTORY:", conversationHistory)

  const languageInstructions: Record<string, string> = {
    en: `You are a professional and friendly virtual assistant for ${config.companyName}. Your goal is to provide excellent customer support in English.`,
    es: `Eres un asistente virtual profesional y amigable para ${config.companyName}. Tu objetivo es proporcionar un excelente soporte al cliente en Español.`,
    ru: `Вы — профессиональный и дружелюбный виртуальный ассистент для ${config.companyName}. Ваша цель — оказывать превосходную поддержку клиентам на русском языке.`,
    ar: `أنت مساعد افتراضي محترف وودود لشركة ${config.companyName}. هدفك هو تقديم دعم عملاء ممتاز باللغة العربية.`,
    zh: `您是${config.companyName}的专业友好虚拟助手。您的目标是用中文提供卓越的客户支持。`,
  };

  const languageResponseInstruction: Record<string, string> = {
    en: "Your Answer (in English):",
    es: "Tu Respuesta (en Español):",
    ru: "Ваш Ответ (на русском языке):",
    ar: "إجابتك (باللغة العربية):",
    zh: "您的回答 (用中文):",
  };

  const selectedInstruction = languageInstructions[language] || languageInstructions.en;
  const selectedResponseInstruction = languageResponseInstruction[language] || languageResponseInstruction.en;

  // Este es el prompt principal que guía a la IA.
  return `
    ${selectedInstruction}

    Our services include:
    ${config.services.map(service => `- ${service}`).join('\n')}

    --- KNOWLEDGE BASE ---
    ${formattedQA}
    --- END KNOWLEDGE BASE ---

    --- CURRENT CONVERSATION HISTORY ---
        ${conversationHistory}
    --- END CONVERSATION HISTORY ---

    BEHAVIORAL INSTRUCTIONS (Examples for english but take into account the other language if applies):

    1. **Analyze the FULL conversation history**: Your primary goal is to provide a relevant and contextual response. The user's latest question might be a direct follow-up to your previous answer OR to a Human Agent's response.

    2. **Understand the multi-party conversation**: The conversation history may include messages from:
       - "User": The customer asking questions
       - "Bot": Your previous responses (you are the Bot)
       - "Human Agent": A human support agent who may have helped the customer before you resumed

       You MUST be aware of what the Human Agent discussed with the user and continue the conversation seamlessly. Do NOT repeat information the agent already provided. Do NOT introduce yourself again if the agent already helped.

    3. **Maintain the thread**: If the user's question is "yes," "why?," or a short phrase, look at the last message (whether from you or the Human Agent) to understand the context and answer accordingly. Do not say you don't understand.

    4. **Be natural and conversational**: Respond in a friendly and professional manner, like an experienced human agent would.

    5. **Interpret intent**: If a user says "hi," "hello," "good afternoon," or similar greetings, respond cordially and offer help. Do not say you don't have that information. But do not respond hi or hello, etc in every message you send

    6. **Use your knowledge base intelligently**:
        - Paraphrase and adapt information without copying it verbatim.
        - Connect related concepts from different parts of the knowledge base.
        - Provide additional context when helpful.

    7. **Be proactive in your guidance**:
        - Anticipate follow-up questions.
        - Suggest relevant next steps.
        - Offer supplementary information that might be useful.

    8. **Acknowledge limitations appropriately**:
        - For very specific, technical, or personalized details.
        - For cases that require access to internal systems.
        - For unique situations not covered in the documentation.

    9. **Never invent information**: If you don't have specific data, be honest but helpful. Offer what you *can* provide.

    10. YOUR RESPONSE CAN'T BE MORE THAN 1500 CHARACTERS LONG

    11. REMEMBER. DON'T SAY HOLA, HELLO, ETC (DEPENDING ON THE LANGUAGE) EVERY TIME YOU RESPOND, JUST AT THE BEGINING OF THE CONVERSATION OR IF THE USER SAYS HI, HELLO, ETC. ALSO DON'T REPEAT THE USER'S NAME EVERY TIME YOU ANSWER

    APPROPRIATE RESPONSE EXAMPLES:
      - User: "Hi" → "Hello! Welcome to ${config.companyName}. How can I help you today?"
      - User: "How much does it cost?" → Provide general price ranges if available, or explain factors that affect the cost.
      - User: "How does it work?" → Explain the general process based on the documentation.
      - User: "I have a specific problem with my account" → Offer general troubleshooting steps and suggest contacting support for specific details.

    Respond in a natural, professional, and helpful manner based on the available knowledge. If you need to escalate to a specialist, do so in a positive and specific way, explaining what kind of additional help they can offer.

    User Question: "${userPrompt}"
    
    ${selectedResponseInstruction};
  `;
}


// --- FUNCIONES ESPECÍFICAS PARA CADA PROVEEDOR DE IA ---
const AI_TIMEOUT_MS = 30000; // 30 seconds

async function generateGeminiResponse(prompt: string, apiKey: string, modelName: string): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName
  })
  const result = await Promise.race([
    model.generateContent(prompt),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Gemini API timeout')), AI_TIMEOUT_MS)
    )
  ]);
  return result.response.text().trim();
}

async function generateKimiResponse(prompt: string, apiKey: string, modelName: string): Promise<string> {
  const response = await axios.post('https://api.moonshot.cn/v1/chat/completions', {
    model: modelName,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
  }, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    timeout: AI_TIMEOUT_MS
  });
  return response.data.choices[0].message.content.trim();
}

async function generateDeepSeekResponse(prompt: string, apiKey: string, modelName: string): Promise<string> {
  const response = await axios.post('https://api.deepseek.com/chat/completions', {
    model: modelName,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
  }, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    timeout: AI_TIMEOUT_MS
  });
  return response.data.choices[0].message.content.trim();
}

// --- Funcion para resumir conversacion 
// async function summarizeConversation(history: Message[], language: string, config: ChatbotConfig, aiConfig: { model: string, apiKey: string }): Promise<string> {

//   const conversationText = history
//     .map(msg => `${msg.role}: ${msg.content}`)
//     .join('\n');

//   const languageInstructions: Record<string, string> = {
//     es: `Eres un asistente experto en resumir conversaciones de soporte. Tu tarea es generar un resumen conciso en Español.`,
//     en: `You are an expert support conversation summarizer. Your task is to generate a concise summary in English.`,
//     // ... (otros idiomas)
//   };

//   const prompt = `
//         ${languageInstructions[language] || languageInstructions.es}
        
//         Resume the following conversation in 3-4 concise bullet points. Focus on the customer's main issue, the key information provided, and the last action taken or question asked.
        
//         CONVERSATION:
//         ---
//         ${conversationText}
//         ---

//         Summary (in ${language}):
//     `;

//   // Reutilizamos la lógica de llamada a la IA que ya tienes
//   if (aiConfig.model.startsWith('gemini')) {
//     return await generateGeminiResponse(prompt, aiConfig.apiKey, aiConfig.model);
//   } else if (aiConfig.model.startsWith('moonshot')) {
//     return await generateKimiResponse(prompt, aiConfig.apiKey, aiConfig.model);
//   } else {
//     // Fallback
//     return await generateGeminiResponse(prompt, aiConfig.apiKey, 'gemini-1.5-flash');
//   }
// }


/**
 * Genera una respuesta al prompt del usuario, usando la configuración dinámica del workspace.
 */
async function generateChatbotResponse(workspaceId: string, userPrompt: string, sessionId: string, language: string, history: Message[] = []): Promise<string | { handoff: true }> {
  console.log(`[Backend] Generating response for workspace: ${workspaceId} in language: ${language}`);

  // --- Detección de Handoff (robusta e independiente del idioma) ---
  const normalizedQuery = userPrompt.toLowerCase();
  const handOffKeywords: Record<string, string[]> = {
    en: ['agent', 'human', 'speak to', 'talk to', 'representative'],
    es: ['agente', 'persona', 'humano', 'hablar con', 'representante', 'asesor'],
    ru: ['агент', 'человек', 'поговорить с', 'оператор'],
    ar: ['وكيل', 'شخص', 'أتحدث مع', 'إنسان', 'ممثل خدمة'],
    zh: ['人工', '客服', '真人', '谈谈', '接线员'],
  };
  // Unimos al menos inglés y español para tolerar desajustes de "language"
  const universalKeywords = Array.from(new Set([
    ...handOffKeywords.es,
    ...handOffKeywords.en,
  ]));
  const matchedKeyword = universalKeywords.find(keyword => normalizedQuery.includes(keyword));
  if (matchedKeyword) {
    console.log(`[Handoff Detection] Triggered by keyword: ${matchedKeyword}`);
    return { handoff: true };
  }

  // 1. Cargar la configuración específica para este workspace desde la base de datos.
  const config = await getWorkspaceConfig(workspaceId);
  const errorMessages: Record<string, string> = {
    en: "I'm sorry, I'm having some technical difficulties. Please try again later.",
    es: "Lo siento, estoy teniendo algunas dificultades técnicas. Por favor, inténtalo de nuevo más tarde.",
    ru: "Извините, у меня возникли технические трудности. Пожалуйста, повторите попытку позже.",
    ar: "أنا آسف، أواجه بعض الصعوبات الفنية. يرجى المحاولة مرة أخرى لاحقًا.",
    zh: "抱歉，我遇到了一些技术问题。请稍后再试。",
  };
  const selectedErrorMessage = errorMessages[language] || errorMessages.en;
  if (!config) {
    return selectedErrorMessage;
  }

  // 2. Búsqueda local usando la configuración dinámica.
  const localAnswer = findLocalAnswer(userPrompt, config);
  if (localAnswer) {
    console.log(`[Local Answer] Respuesta encontrada en la configuración del workspace ${workspaceId}.`);
    return localAnswer;
  }

  // 3. Preparar el prompt
  const fullPrompt = generateAIContext(config, userPrompt, language, history);

  try {
    // 4. Determinar qué clave API usar
    let apiKey: string | undefined;
    if (config.ai_api_key_name) {
      apiKey = process.env[config.ai_api_key_name]
    }

    // Si no se encontró una clave específica (o no se configuró ninguna), usar la del sistema por defecto
    if (!apiKey) {
      apiKey = process.env.GEMINI_API_KEY_DEFAULT;
    }

    if (!apiKey) {
      throw new Error(`API Key not found. Reference name: ${config.ai_api_key_name || 'default'}`);
    }

    const modelName = config.ai_model;

    // --- 5. Enrutador de Modelos ---
    let textResponse: string;

    if (modelName.startsWith('gemini')) {
      console.log(`[AI Backend] Routing to Gemini with model: ${modelName}`);
      textResponse = await generateGeminiResponse(fullPrompt, apiKey, modelName);
    } else if (modelName.startsWith('moonshot')) {
      console.log(`[AI Backend] Routing to Kimi (Moonshot) with model: ${modelName}`);
      textResponse = await generateKimiResponse(fullPrompt, apiKey, modelName);
    } else if (modelName.startsWith('deepseek')) {
      console.log(`[AI Backend] Routing to DeepSeek with model: ${modelName}`);
      textResponse = await generateDeepSeekResponse(fullPrompt, apiKey, modelName);
    } else {
      // Fallback si el modelo no es reconocido
      console.warn(`[AI Backend] Unknown model '${modelName}'. Falling back to default Gemini.`);
      const defaultApiKey = process.env.GEMINI_API_KEY_DEFAULT;
      if (!defaultApiKey) throw new Error("Default Gemini API Key is not configured.");
      textResponse = await generateGeminiResponse(fullPrompt, defaultApiKey, 'gemini-2.0-flash');
    }

    if (textResponse) {
      return textResponse.trim();
    }

    throw new Error('Invalid or empty response from AI API');

  } catch (error) {
    console.error('Error in AI API call:', error);
    return selectedErrorMessage;
  }
}

/**
 * El objeto de servicio del backend.
 */
export const chatbotServiceBackend = {
  generateChatbotResponse,
};