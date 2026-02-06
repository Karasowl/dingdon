// app/services/chatbotServiceClient.ts

import { apiClient } from "../apiClient";
import { ChatApiResponse, Message } from "@/types/chatbot";

/**
 * @file API service for client-side chat operations.
 * @description This module encapsulates all API calls the client makes to its
 * own backend for chatbot functionality. It uses the centralized `apiClient`.
 */


/**
 * Sends a user's message to our backend chat API endpoint.
 * This function is designed to be called from client-side components/hooks.
 * @param message - The text content from the user.
 * @param sessionId - The unique identifier for the current chat session.
 * @returns A promise that resolves to the AI's reply string, fetched from our backend.
 * @throws Will throw an error if the API call to our backend fails.
 */
async function postChatMessage(workspaceId: string, message: string, sessionId: string, history: Message[], language: string): Promise<ChatApiResponse> {
  try {
    const response = await apiClient.post<ChatApiResponse>('/chat', { workspaceId, message, sessionId, history, language });

    if (response.data && response.data.reply) {
      return response.data;
    }

    throw new Error('Invalid response format from server.');

  } catch (error) {
    console.error('Error posting chat message to backend:', error);
    throw new Error('Failed to get a response from the server.');
  }
};

/**
 * A collection of client-side chat-related API functions.
 * This makes it easy to import and use in hooks or components.
 */
export const chatbotServiceClient = {
  postChatMessage,
};