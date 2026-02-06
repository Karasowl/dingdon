/**
 * @file Defines the core types for the chatbot application.
 * @description These types are used across the frontend and backend to ensure consistency.
 */

// Represents the roles that can be assigned to messages in the chat.
type Roles = 
  'user'      | // The user who interacts with the chatbot
  'assistant' | // The chatbot itself, providing responses
  'system'    | // System messages, typically for internal use
  'agent'       // An agent who can take over the conversation


/**
 *  Defines the application roles for user management.
 */
export type AppRole = 'superadmin' | 'admin' | 'agent';
 

/**
 * Represents a single message in the chat conversation.
 */
export interface Message {
  id: string;
  content: string;
  role: Roles 
  timestamp: Date;
  agentName?: string; 
  avatarUrl?: string;
}

/**
 * Defines the structure for the chatbot's knowledge base.
 * This configures the bot's identity, services, and predefined answers.
 */
export interface ChatbotConfig {
  companyName: string;
  services: string[];
  commonQuestions: { question: string; answer: string }[];
}

/**
 * The expected structure of the response from our own chat API endpoint from Gemini (/api/chat).
 */
export interface ChatApiResponse {
  reply: string;
  handoff?: boolean;
}
 
/**
 * Represents a chat session, which includes the messages exchanged and the session status.
 */
export type ChatSessionStatus = 
  'bot'             // The bot is handling the session 
| 'pending'   // The session is waiting for an agent to take over
| 'in_progress'     // The session is currently being handled by an agent
| 'closed';         // The session has been closed

export interface ChatSession {
  id: string;
  messages: Message[];
  status: ChatSessionStatus;
  assignedAgentId?: string;
}


/**
 * Representa el rol de un miembro dentro de un workspace.
 */
export type WorkspaceRole = 'admin' | 'agent';

/**
 * Representa un miembro del equipo (agente o admin) en la UI.
 */
export interface TeamMember {
  id: string;
  name: string | null;
  email: string | null;
  role: WorkspaceRole;
}

// Estructura de un workspace en la aplicación.
export interface ChatRequest {
    sessionId: string;
    initialMessage: Message;
    isTransfer?: boolean;
}

// Estado para el chat que se está viendo en detalle
export interface ActiveChat {
    sessionId: string;
    messages: Message[];
    status: ChatSessionStatus;
}

// Configuración del bot 
export interface BotConfig {
    name?: string;
    avatarUrl?: string;
}