// app/hooks/useChatbot.ts
'use client';
import { useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '@/stores/chatbotStore';
import { Message, ChatSessionStatus } from '@/types/chatbot';
import { chatbotServiceClient } from '@/services/client/chatbotServiceClient';
import { io, Socket } from 'socket.io-client';


/**
 * @file The main client-side hook for managing the chatbot's state and logic.
 * @description This hook is the primary interface for the UI components. It integrates
 * the Zustand store for reactive state management and React Query for handling
 * asynchronous API calls to the backend via the `chatbotServiceClient`.
 */

/**
 * A custom hook that provides all the necessary state and functions for the chatbot UI.
 * @returns An object containing the chat's state (messages, isOpen, isLoading) and
 * functions to interact with it (toggleChat, sendMessage).
 */
export const useChatbot = () => {
  const {
    messages,
    addMessage,
    setIsLoading,
    toggleChat,
    status,
    sessionId,
    startSession,
    setSessionStatus,
    resetChat,
    workspaceId,
    setWorkspaceId,
    config,
    setConfig,
    error,
    setError,
    language,
    initializeOrSyncWorkspace,
    leadCollected,
    setLeadCollected,
    systemNotification,
    setSystemNotification,
    requestAgentHandoff
  } = useChatStore(

    // useShallow prevents re-renders if other parts of the state change
    useShallow((state) => ({
      messages: state.messages,
      addMessage: state.addMessage,
      setIsLoading: state.setIsLoading,
      toggleChat: state.toggleChat,
      isOpen: state.isOpen,
      isLoading: state.isLoading,
      status: state.status,
      sessionId: state.sessionId,
      startSession: state.startSession,
      setSessionStatus: state.setSessionStatus,
      resetChat: state.resetChat,
      workspaceId: state.workspaceId,
      setWorkspaceId: state.setWorkspaceId,
      config: state.config,
      setConfig: state.setConfig,
      error: state.error,
      setError: state.setError,
      language: state.language,
      initializeOrSyncWorkspace: state.initializeOrSyncWorkspace,
      leadCollected: state.leadCollected,
      setLeadCollected: state.setLeadCollected,
      systemNotification: state.systemNotification,
      setSystemNotification: state.setSystemNotification,
      requestAgentHandoff: state.requestAgentHandoff
    }))
  );

  // Reference to the socket connection
  const socketRef = useRef<Socket | null>(null);

  // --- GESTOR DE CAMBIO DE WORKSPACE ---
  useEffect(() => {
    // 1. Obtiene el ID "real" del widget desde la configuración de la ventana.
    const newWorkspaceIdFromConfig = (window as any).chatbotConfig?.workspaceId;

    // 2. Si la configuración aún no está lista, avisa y espera.
    if (!newWorkspaceIdFromConfig) {
      console.warn('[useChatbot] Esperando a que chatbotConfig esté disponible...');
      return;
    }

    // 3. Llama a nuestra nueva y más inteligente acción `setWorkspaceId`.
    // El store se encargará de decidir si debe resetear o no.
    setWorkspaceId(newWorkspaceIdFromConfig);

  }, [setWorkspaceId]);


  // - useEffect de WebSocket 

  useEffect(() => {

    if (workspaceId && !sessionId) {
      console.log('[Chatbot] Workspace ID presente. Iniciando nueva sesión...');
      startSession();
    }

    if (sessionId && !socketRef.current) {
      // Initialize the socket connection
      const socket = io(process.env.NEXT_PUBLIC_WEBSOCKET_URL || 'http://localhost:3001')
      socketRef.current = socket;

      // 🔧 CAMBIO 1: Configurar listeners ANTES de hacer join
      socket.on('agent_message', (message: Message) => {
        console.log(`[Chatbot] Agent message received:`, message);
        addMessage(message);
      });

      socket.on('status_change', (data: ChatSessionStatus | { status: ChatSessionStatus; name: string; type: 'agent_joined' | 'bot_returned' | 'agent_returned' }) => {
        // Soportar formato antiguo (solo status) y nuevo (objeto con name y type)
        const newStatus = typeof data === 'string' ? data : data.status;
        const notificationName = typeof data === 'object' ? data.name : null;
        const notificationType = typeof data === 'object' ? data.type : null;

        console.log(`[Chatbot] Status change to: ${newStatus}`, notificationName ? `by ${notificationName}` : '');
        setSessionStatus(newStatus);

        // Mostrar notificación del sistema si hay nombre
        if (notificationName && notificationType) {
          setSystemNotification({ type: notificationType, name: notificationName });
          // Auto-limpiar la notificación después de 5 segundos
          setTimeout(() => {
            setSystemNotification(null);
          }, 5000);
        }

        // 🔧 CAMBIO 2: Re-join INMEDIATAMENTE cuando cambia el status
        if (newStatus === 'in_progress' && sessionId) {
          socket.emit('join_session', sessionId);
          console.log(`[Chatbot] Re-joined session ${sessionId} for agent chat`);
        }
      });

      // 🔧 CAMBIO 3: Join inicial después de configurar listeners
      socket.emit('join_session', sessionId);
      console.log(`[Chatbot] Joined session ${sessionId}`);

      // 🔧 CAMBIO 4: Listener para confirmar que estamos en la sala
      socket.on('connect', () => {
        console.log(`[Chatbot] Socket connected, re-joining session ${sessionId}`);
        socket.emit('join_session', sessionId);
      });

      // 🔧 CAMBIO 5: Listener para reconexión
      socket.on('disconnect', () => {
        console.log(`[Chatbot] Socket disconnected`);
      });

      socket.on('reconnect', () => {
        console.log(`[Chatbot] Socket reconnected, re-joining session ${sessionId}`);
        socket.emit('join_session', sessionId);
      });
    }

    // Cleanup function
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    }
  }, [workspaceId, sessionId, startSession, setSessionStatus, addMessage]);

  // --- USEEFFECT PARA CARGAR LA CONFIG DEL BOT! ---
  // useEffect(() => {
  //   if (workspaceId) {
  //     const fetchConfig = async () => {
  //       try {
  //         const response = await fetch(`/api/public/config/${workspaceId}`);
  //         if (response.ok) {
  //           const data = await response.json();
  //           setConfig({
  //             botName: data.bot_name || 'Virtual Assistant',
  //             botColor: data.bot_color || '#007bff',
  //           });
  //         }
  //       } catch (error) {
  //         console.error("Failed to fetch public bot config:", error);
  //       }
  //     };
  //     fetchConfig();
  //   }
  // }, [workspaceId, setConfig]);

  useEffect(() => {
    if (workspaceId) {
      const fetchConfig = async () => {
        try {
          const response = await fetch(`/api/public/config/${workspaceId}`);
          if (response.ok) {
            const data = await response.json();
            const newConfig = {
              botName: data.bot_name || 'Virtual Assistant',
              botColor: data.bot_color || '#007bff',
              botAvatarUrl: data.bot_avatar_url,
              botIntroduction: data.bot_introduction,
            };
            setConfig(newConfig);


            // Envía un mensaje a la ventana padre (la página anfitriona) con el nuevo color.
            if (window.parent) {
              window.parent.postMessage({
                type: 'CHATBOT_COLOR_UPDATE', // Un identificador para nuestro mensaje
                color: newConfig.botColor
              }, '*'); // '*' permite enviarlo a cualquier dominio anfitrión.
            }
            

          }
        } catch (error) {
          console.error("Failed to fetch public bot config:", error);
        }
      };
      fetchConfig();
    }
  }, [workspaceId, setConfig]);

  const mutation = useMutation({

    mutationFn: (variables: {
      workspaceId: string,
      message: string,
      sessionId: string,
      history: Message[],
      language: string,
    }) => chatbotServiceClient.postChatMessage(variables.workspaceId, variables.message, variables.sessionId, variables.history, variables.language),

    onMutate: () => {
      setIsLoading(true);
    },

    onSuccess: (data) => {
      const assistantMessage: Message = {
        id: `asst-${Date.now()}`,
        content: data.reply,
        role: 'assistant',
        timestamp: new Date(),
      };
      addMessage(assistantMessage);

      // Send the bot's message to save it
      if (socketRef.current && sessionId && workspaceId) {
        socketRef.current.emit('user_message', { workspaceId, sessionId, message: assistantMessage })
      }

      // If the backend detected a handoff, transition status to 'pending'
      if (data.handoff) {
        console.log('[useChatbot] Handoff detected, transitioning to pending status');
        requestAgentHandoff();
      }
    },

    onError: (error) => {
      console.error('Mutation Error in useChatbot:', error);
      const errorMessage: Message = {
        id: `err-${Date.now()}`,
        content: "I'm having trouble connecting. Please check your connection and try again.",
        role: 'system', // 'system' role for visually distinct error messages
        timestamp: new Date(),
      };
      addMessage(errorMessage);
    },

    onSettled: () => {
      // This runs after onSuccess or onError
      setIsLoading(false);
    },
  });

  /**
   * Public function to send a new message.
   * It adds the user's message to the state immediately for a snappy UI
   * and then triggers the mutation to get the assistant's response.
   * @param {string} content - The text content of the user's message.
   */
  const sendMessage = (content: string) => {

    console.log('🔍 [useChatbot] sendMessage called with:', {
      content,
      contentTrim: content.trim(),
      mutationPending: mutation.isPending,
      sessionId,
      workspaceId,
      status,
      messagesCount: messages.length
    });

    if (!content.trim()) {
      console.log('❌ [useChatbot] Message rejected: content is empty');
      return;
    }

    if (mutation.isPending) {
      console.log('❌ [useChatbot] Message rejected: mutation is pending');
      return;
    }

    if (!sessionId) {
      console.log('❌ [useChatbot] Message rejected: no sessionId');
      return;
    }

    if (!workspaceId) {
      console.log('❌ [useChatbot] Message rejected: no workspaceId');
      return;
    }

    console.log('✅ [useChatbot] All checks passed, creating user message');

    if (!content.trim() || mutation.isPending || !sessionId || !workspaceId) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      content,
      role: 'user',
      timestamp: new Date(),
    };

    addMessage(userMessage);

    // Siempre enviamos el mensaje del usuario al servidor para que se guarde y/o reenvíe
    if (socketRef.current) {
      // --- CAMBIO: Añadimos workspaceId al payload ---
      socketRef.current.emit('user_message', { workspaceId, sessionId, message: userMessage });
    }

    // Solo llamamos a la IA si el estado es 'bot'
    if (status === 'bot') {
      const updatedHistory = [...messages, userMessage];

      // --- LOG #1: ¿QUÉ HISTORIAL ESTAMOS ENVIANDO? ---
      console.log(`[useChatbot] Enviando a /api/chat. El historial tiene ${updatedHistory.length} mensajes.`, JSON.stringify(updatedHistory.map(m => ({ role: m.role, content: m.content.slice(0, 20) }))));

      // --- CAMBIO: Pasamos el workspaceId a la mutación ---
      mutation.mutate({ workspaceId, message: content, sessionId, history: updatedHistory, language });
    }
  };



  /**
   * Function to resets the chat state if the chat is being closed.
   */
  const startNewChat = () => {
    // Disconnect the current socket if it exists
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    // Reset the chat state
    resetChat();
  }

  return {
    messages,
    status,
    isLoading: mutation.isPending,
    config,
    toggleChat,
    sendMessage,
    startNewChat,
    error,
    leadCollected,
    setLeadCollected,
    workspaceId,
    systemNotification
  };
};

