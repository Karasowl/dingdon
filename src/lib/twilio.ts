// // app/lib/twilio.ts
// import twilio from 'twilio';


// const accountSid = process.env.TWILIO_ACCOUNT_SID;
// const authToken = process.env.TWILIO_AUTH_TOKEN;
// const twilioWhatsAppNumber = process.env.TWILIO_WHATSAPP_NUMBER;

// // Solo incializamos el cliente si tenemos las credenciales
// const client = accountSid && authToken ? twilio(accountSid, authToken) : null;

// export async function sendWhatsAppMessage(to: string, body: string) {
    
//     if (!client) {
//         console.error("Twilio client not initialized. Check env variables")
//         return
//     }

//     if (!twilioWhatsAppNumber) {
//         console.error("Twilio WhatsApp number is not configured.")
//         return
//     }

//     try {
//         await client.messages.create({
//             from: twilioWhatsAppNumber,
//             to: to,                            // El numero de whatsapp del usuario
//             body: body
//         })
//         console.log(`Whatsapp message sent to ${to}`)
//     } catch (error) {
//         console.error(`Failed to send WhatsApp message to ${to}:`, error);
//         return 'Failed to send message';
//     }



// }


// app/lib/twilio.ts

import twilio from 'twilio';
import { validateRequest } from 'twilio';

// Definimos un tipo para el objeto de configuración para mayor seguridad y claridad.
interface TwilioConfig {
    id: string;
    config_name: string;
    account_sid: string;
    whatsapp_number: string;
    description?: string;
}

/**
 * Esta función crea un cliente de Twilio bajo demanda.
 * Recibe el Account SID y el nombre de la config para buscar el Auth Token.
 * @param {*} accountSid 
 * @param {*} configName 
 */
function getTwilioClient(accountSid: string, configName: string) {
    // Construye el nombre de la variable de entorno para el Auth Token
    const authTokenEnvVar = `TWILIO_TOKEN_${configName}`;
    const authToken = process.env[authTokenEnvVar];

    if (!authToken) {
        console.error(`Error: La variable de entorno '${authTokenEnvVar}' no está definida.`);
        return null;
    }

    if (accountSid && authToken) {
        return twilio(accountSid, authToken);
    }
    
    console.error("Error: Faltan el Account SID o el Auth Token para crear el cliente de Twilio.");
    return null;
}

/**
 * Validates that a request actually comes from Twilio by checking the signature.
 */
export function validateTwilioRequest(
    twilioConfig: TwilioConfig,
    signature: string,
    url: string,
    params: Record<string, string>
): boolean {
    const authTokenEnvVar = `TWILIO_TOKEN_${twilioConfig.config_name}`;
    const authToken = process.env[authTokenEnvVar];
    if (!authToken) return false;
    return validateRequest(authToken, signature, url, params);
}

/**
 * La función principal ahora recibe un objeto de configuración completo.
 * @param {*} to 
 * @param {*} body 
 * @param {*} twilioConfig 
 */
export async function sendWhatsAppMessage(to: string, body: string, twilioConfig: TwilioConfig | null) {
    // Si no se proporciona una configuración, no podemos hacer nada.
    if (!twilioConfig) {
        console.error("No se proporcionó una configuración de Twilio. No se puede enviar el mensaje.");
        throw new Error("Missing Twilio configuration.");
    }
    
    // Verificación adicional de campos necesarios.
    if (!twilioConfig.account_sid || !twilioConfig.config_name || !twilioConfig.whatsapp_number) {
        console.error("El objeto de configuración de Twilio está incompleto. No se puede enviar el mensaje.");
        throw new Error("Incomplete Twilio configuration.");
    }
    
    const client = getTwilioClient(twilioConfig.account_sid, twilioConfig.config_name);
    if (!client) {
        // getTwilioClient ya habrá mostrado un error detallado.
        throw new Error("Failed to initialize Twilio client.");
    }

    try {
        await client.messages.create({
            from: twilioConfig.whatsapp_number,
            to: to,
            body: body
        });
        console.log(`Mensaje de WhatsApp enviado a ${to} usando la configuración '${twilioConfig.config_name}'`);
    } catch (error) {
        console.error(`Fallo al enviar el mensaje de WhatsApp usando la configuración '${twilioConfig.config_name}':`, error);
        // Re-lanzamos el error para que la API del webhook pueda manejarlo y devolver una respuesta 500.
        throw error;
    }
}
